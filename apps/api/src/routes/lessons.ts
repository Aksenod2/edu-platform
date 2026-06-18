import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { notifyMany } from '../lib/notifications.js';
import { isEnrolled } from '../lib/enrollment.js';
import { computeProgress, MAX_INPUT_INTERVALS } from '../lib/video-progress.js';
import {
  uploadFile,
  uploadLargeFile,
  VIDEO_MAX_FILE_SIZE,
  getFileUrl,
  verifyStoredObject,
  deleteFile,
  readFileText,
} from '../lib/s3.js';
import {
  createZoomMeeting,
  shouldAutoCreate,
  canCreateMeeting,
  deleteZoomMeeting,
} from '../lib/zoom.js';
import {
  processRecordingForSession,
  processSummaryForSession,
  processTranscriptForSession,
  type ProcessOutcome,
} from '../lib/zoom-recording.js';
import { pullSessionAttendanceFromZoom } from '../lib/zoom-attendance.js';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

// ─── Projection shim ────────────────────────────────────────────────────────
//
// Модель данных переехала: Lesson теперь — переиспользуемый БЛОК (без расписания),
// а расписание/статус живут в Session (streamId × lessonId). Программа (Program)
// связывает уроки через ProgramLesson (упорядоченная M:N), а Stream ссылается на
// Program. Менторские потоки (program = null) держат уроки прямо через свои Session.
//
// Этот файл сохраняет СТАРЫЕ формы запросов/ответов для фронта: каждый «урок» в
// ответе — это плоский объект блока + спроецированные из Session поля
// streamId/status/date/startTime/meetingUrl (+ видео). Так фронт продолжает
// работать без изменений, пока модель уже новая.

// Дескриптор учебного материала урока (только PDF/MD).
// Файл хранится в FileStorage по s3Key; url — подписанная временная ссылка,
// которую ре-подписываем при каждой выдаче GET.
export interface LessonMaterial {
  s3Key: string;
  fileName: string;
  mimeType: string;
  size: number;
  url?: string;
  // Изоляция материалов по потокам (Волна «Изоляция материалов урока по группам»).
  // Признак ВИДИМОСТИ в JSON-дескрипторе (без миграции схемы):
  //   null/undefined = общий материал-метод (виден студентам ВСЕХ потоков);
  //   задан          = материал виден ТОЛЬКО студентам этого потока.
  // Старые материалы (без поля) трактуются как общие.
  streamId?: string | null;
}

// Подписанный временный URL загруженного видео урока по videoKey (или null).
// Если videoKey пуст — видео загружено не было (есть только внешняя ссылка videoUrl).
async function videoFileUrlFor(videoKey: string | null | undefined): Promise<string | null> {
  if (!videoKey) return null;
  try {
    return await getFileUrl(videoKey);
  } catch {
    return null;
  }
}

// Контекст получателя для фильтрации материалов/видео по потоку.
//   - isAdmin=true  → видит ВСЁ (управление контентом, «копилка» без streamId);
//   - isAdmin=false → видит только streamId == null ИЛИ streamId == viewerStreamId.
// Используется в projectVideos / regenerateLessonMaterialUrls / finalizeLesson.
export interface MaterialVisibilityContext {
  viewerStreamId: string | null;
  isAdmin: boolean;
}

// По умолчанию (admin-only роуты POST/PATCH) — админский контекст без сужения,
// чтобы прежнее поведение мутаций не менялось.
const ADMIN_VISIBILITY: MaterialVisibilityContext = { viewerStreamId: null, isAdmin: true };

// Виден ли материал/видео получателю по признаку streamId.
//   - админ — всё;
//   - студент — общий (null/undefined) ИЛИ ровно своего потока.
function isVisibleForViewer(
  itemStreamId: string | null | undefined,
  ctx: MaterialVisibilityContext,
): boolean {
  if (ctx.isAdmin) return true;
  if (itemStreamId == null) return true; // общий метод
  return itemStreamId === ctx.viewerStreamId;
}

// Нормализует входной streamId видимости для загрузки материала/видео (admin).
// Возвращает:
//   - undefined → поле не задано (общий контент, streamId не пишем / null);
//   - null      → задано пустым → трактуем как общий (нормализуем к null);
//   - string    → конкретный поток (требует валидации против сессий урока).
// Для multipart streamId читается из query, для JSON — из тела (передаём raw).
function normalizeVisibilityStreamId(raw: unknown): string | null | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return null; // явно пустая строка → общий
  return trimmed;
}

// Допустимые потоки для материала/видео урока — это потоки, у которых ЕСТЬ Session
// этого урока (источник тот же, что в GET /lessons/:id/sessions). Если streamId
// задан, но урок не ведёт такой поток — бросаем StreamNotForLesson (→ 400 в роуте).
class StreamNotForLessonError extends Error {}

// Проверяет, что у урока есть Session с таким streamId. Возвращает streamId как есть.
async function assertStreamRunsLesson(lessonId: string, streamId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { streamId_lessonId: { streamId, lessonId } },
    select: { streamId: true },
  });
  if (!session) {
    throw new StreamNotForLessonError(
      'Указанный поток не ведёт этот урок — выберите поток из расписания урока или оставьте материал общим',
    );
  }
}

// Спроецированное видео урока для ответов фронту: kind различает файл/ссылку,
// url — подписанный временный URL файла или внешняя ссылка как есть.
type ProjectedVideo = { id: string; title: string | null; kind: 'file' | 'link'; url: string; sortOrder: number };

// Проецирует список видео урока: для файлов подписываем временный URL по videoKey,
// для ссылок берём videoUrl напрямую. Видео без url/key и файлы без валидной подписи
// отбрасываем (как одиночное видео в videoFileUrlFor).
// ctx ограничивает выдачу студенту его потоком: чужие видео отбрасываем ДО подписи
// URL (не подписываем чужие ключи — это и утечка доступа, и лишняя работа). Админ —
// без сужения. Видео без streamId — общий метод, видно всем.
async function projectVideos(
  videos: LessonBlock['videos'],
  ctx: MaterialVisibilityContext = ADMIN_VISIBILITY,
): Promise<ProjectedVideo[]> {
  if (!videos?.length) return [];
  const visible = videos.filter((v) => isVisibleForViewer(v.streamId, ctx));
  const out = await Promise.all(
    visible.map(async (v) => {
      if (v.videoKey) {
        const url = await videoFileUrlFor(v.videoKey);
        return url ? { id: v.id, title: v.title, kind: 'file' as const, url, sortOrder: v.sortOrder } : null;
      }
      if (v.videoUrl) {
        return { id: v.id, title: v.title, kind: 'link' as const, url: v.videoUrl, sortOrder: v.sortOrder };
      }
      return null;
    }),
  );
  return out.filter((x): x is ProjectedVideo => x !== null);
}

// Свежий список видео урока в проекции (для ответов мутаций).
async function lessonVideosResponse(lessonId: string): Promise<{ videos: ProjectedVideo[] }> {
  const videos = await prisma.lessonVideo.findMany({
    where: { lessonId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return { videos: await projectVideos(videos) };
}

// Ре-подписывает временные url по s3Key для материалов урока.
// ctx ограничивает выдачу студенту его потоком: чужие материалы отбрасываем ДО
// подписи URL (не подписываем чужие ключи — утечка доступа + лишняя работа). Админ —
// без сужения. Материал без streamId — общий метод, виден всем.
export async function regenerateLessonMaterialUrls(
  materials: LessonMaterial[],
  ctx: MaterialVisibilityContext = ADMIN_VISIBILITY,
): Promise<LessonMaterial[]> {
  const visible = materials.filter((m) => isVisibleForViewer(m.streamId, ctx));
  return Promise.all(
    visible.map(async (m) => {
      if (m.s3Key) {
        try {
          return { ...m, url: await getFileUrl(m.s3Key) };
        } catch {
          return m;
        }
      }
      return m;
    }),
  );
}

// Нормализует входной массив дескрипторов материалов (из POST/PATCH):
// храним только s3Key/fileName/mimeType/size, url не сохраняем (он временный).
export function sanitizeLessonMaterials(input: unknown): LessonMaterial[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter((m) => typeof m.s3Key === 'string' && typeof m.fileName === 'string')
    .map((m) => ({
      s3Key: m.s3Key as string,
      fileName: m.fileName as string,
      mimeType: typeof m.mimeType === 'string' ? m.mimeType : 'application/octet-stream',
      size: typeof m.size === 'number' ? m.size : 0,
      // Признак видимости: только строка → иначе null (общий материал-метод).
      // Отсутствие поля = общий материал (как старые данные).
      streamId: typeof m.streamId === 'string' ? m.streamId : null,
    }));
}

// Допускаем строго PDF и Markdown. mime для .md часто пустой/text/plain,
// поэтому проверяем И mime, И расширение имени файла.
const PDF_MD_MIME_TYPES = new Set([
  'application/pdf',
  'text/markdown',
  'text/x-markdown',
]);

function isPdfOrMarkdown(fileName: string, mimeType: string): boolean {
  const lowerName = (fileName || '').toLowerCase();
  if (lowerName.endsWith('.pdf') || lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return true;
  }
  return PDF_MD_MIME_TYPES.has((mimeType || '').toLowerCase());
}

// Допускаем ТОЛЬКО web-проигрываемые форматы: MP4 (H.264) и WebM. .mov/QuickTime
// и .m4v браузеры (Chrome/Firefox, и десктоп, и мобилка) не воспроизводят —
// поэтому НЕ принимаем их при загрузке (иначе у урока «чёрный экран»). Проверяем
// И расширение, И mime: пустой/неточный mime (бывает у файлов) допускаем при
// корректном расширении, но video/quicktime и т.п. отсекаем.
const VIDEO_EXTENSIONS = ['.mp4', '.webm'];
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm']);

function isVideoFile(fileName: string, mimeType: string): boolean {
  const lowerName = (fileName || '').toLowerCase();
  const okExt = VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const m = (mimeType || '').toLowerCase();
  const okMime = VIDEO_MIME_TYPES.has(m) || m === '' || m === 'application/octet-stream';
  return okExt && okMime;
}

// Статусы урока (в новой модели — статус Session). Черновик скрыт от учеников,
// остальные — видны (видимость = статус).
const LESSON_STATUSES = ['draft', 'planned', 'done', 'cancelled'] as const;
type LessonStatusValue = (typeof LESSON_STATUSES)[number];

function isLessonStatus(value: unknown): value is LessonStatusValue {
  return typeof value === 'string' && (LESSON_STATUSES as readonly string[]).includes(value);
}

// Нормализует входную дату "YYYY-MM-DD" → Date (наивная @db.Date) | null.
function parseLessonDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  return new Date(datePart);
}

// Собирает локальное время старта встречи 'YYYY-MM-DDTHH:MM:00' из даты занятия
// и времени начала (HH:MM). Если времени нет — возвращает null (Zoom создаст
// встречу без фиксированного времени, type 1).
function buildZoomStartTime(date: Date, startTime: string | null | undefined): string | null {
  if (!startTime || !startTime.trim()) return null;
  const datePart = date.toISOString().slice(0, 10);
  const time = startTime.trim().slice(0, 5); // HH:MM
  return `${datePart}T${time}:00`;
}

// Пытается создать встречу Zoom для занятия под аккаунтом текущего преподавателя
// и вернуть её join_url вместе с meetingId. Возвращает null, если создание не
// требуется/недоступно или ссылка уже задана (ручная/сохранённая — не перезатираем).
//
// Поле opts.generateMeeting управляет тем, КОГДА создавать встречу:
//   - true      → создавать по запросу фронта даже при выключенном глобальном
//                 тумблере autoCreateMeeting; нужны лишь технические предусловия
//                 интеграции (canCreateMeeting) + дата + отсутствие ручной/сохранённой
//                 ссылки;
//   - false     → явный отказ: не создавать, даже если тумблер включён;
//   - undefined → прежнее поведение: создавать по глобальному тумблеру
//                 (shouldAutoCreate).
//
// УСТОЙЧИВОСТЬ: любые ошибки Zoom гасятся (логируем warn и возвращаем null) —
// планирование занятия не должно падать из-за интеграции.
async function maybeCreateMeetingUrl(
  app: FastifyInstance,
  userId: string,
  opts: {
    date: Date | null;
    startTime: string | null | undefined;
    bodyMeetingUrl: string | null | undefined;
    existingMeetingUrl: string | null | undefined;
    topic: string;
    generateMeeting?: boolean;
  },
): Promise<{ joinUrl: string; meetingId: string } | null> {
  // Явный отказ от генерации (даже при включённом тумблере).
  if (opts.generateMeeting === false) return null;
  // Нужна дата занятия (без даты не планируем встречу).
  if (!opts.date) return null;
  // Ручной meetingUrl всегда уважаем; существующую/сохранённую ссылку не перезатираем.
  if (opts.bodyMeetingUrl && opts.bodyMeetingUrl.trim()) return null;
  if (opts.existingMeetingUrl && opts.existingMeetingUrl.trim()) return null;

  try {
    // generateMeeting === true → достаточно технических предусловий интеграции
    // (игнорируем тумблер). Иначе (undefined) — по глобальному тумблеру.
    const ok =
      opts.generateMeeting === true
        ? await canCreateMeeting(userId)
        : await shouldAutoCreate(userId);
    if (!ok) return null;
    const { joinUrl, meetingId } = await createZoomMeeting(userId, {
      topic: opts.topic,
      startTime: buildZoomStartTime(opts.date, opts.startTime),
      durationMinutes: 60,
    });
    return { joinUrl, meetingId };
  } catch (err) {
    app.log.warn(
      { err, userId },
      'Не удалось создать встречу Zoom — продолжаем без ссылки',
    );
    return null;
  }
}

// Без `as const`: вложенный orderBy видео — массив, а Prisma-тип LessonInclude
// ждёт МУТАБЕЛЬНЫЙ массив orderBy (readonly-кортеж из `as const` он не принимает).
// Результаты всё равно приводятся к LessonBlock, точная инференс-форма не нужна.
const teacherInclude = {
  teachers: { include: { user: { select: { id: true, name: true } } } },
  // Видео урока в порядке отображения (для аддитивного поля videos[]).
  videos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.LessonInclude;

// where-фильтр видимости видео урока на уровне SQL-выборки (опирается на индекс
// [lessonId, streamId]). Для студента: только общие (streamId IS NULL) ИЛИ его
// потока — чужие видео НЕ попадают в выборку (не тянем в память, не подписываем).
// Для админа — undefined (без сужения, видит всё). Используется в include видео,
// чтобы Prisma делал один батч-запрос по всем урокам выборки (без N+1).
function videoWhereFor(ctx: MaterialVisibilityContext): Prisma.LessonVideoWhereInput | undefined {
  if (ctx.isAdmin) return undefined;
  return { OR: [{ streamId: null }, { streamId: ctx.viewerStreamId }] };
}

// Фабрика include блока урока с учётом контекста получателя: для студента видео
// фильтруются на уровне SQL (videoWhereFor). teacherInclude — частный случай (админ).
function teacherIncludeFor(ctx: MaterialVisibilityContext) {
  const where = videoWhereFor(ctx);
  return {
    teachers: { include: { user: { select: { id: true, name: true } } } },
    videos: {
      ...(where ? { where } : {}),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    },
  } satisfies Prisma.LessonInclude;
}

// Тип блока урока с подгруженными преподавателями (минимум, который проецируем).
type LessonBlock = {
  id: string;
  title: string;
  videoUrl: string | null;
  videoKey: string | null;
  summary: string | null;
  notes: string | null;
  materials: unknown;
  sortOrder: number;
  hasAssignment: boolean;
  assignmentTitle: string | null;
  assignmentDescription: string | null;
  assignmentCriteria: string | null;
  assignmentType: 'short' | 'long' | null;
  assignmentTags: string[];
  assignmentMaterials: unknown;
  createdAt: Date;
  updatedAt: Date;
  teachers?: { user: { id: string; name: string } }[];
  // Несколько видео урока: каждое — ЛИБО файл (videoKey) ЛИБО внешняя ссылка (videoUrl).
  // streamId: null = общее видео-метод (видно всем), задан = только своего потока.
  videos?: { id: string; title: string | null; videoKey: string | null; videoUrl: string | null; sortOrder: number; streamId?: string | null }[];
};

// Минимальные поля Session, которые проецируются в форму урока.
type SessionProjection = {
  status: LessonStatusValue;
  date: Date | null;
  startTime: string | null;
  meetingUrl: string | null;
  videoUrl: string | null;
  videoKey: string | null;
  // Итоги конкретного занятия потока + автосбор записи Zoom (Волна 2).
  // Все поля nullable — фича аддитивна; для старых данных останутся null.
  summary: string | null;
  summarySource: string | null;
  summaryStatus: string | null;
  recordingStatus: string | null;
  recordingError: string | null;
  // Моменты начала ожидания записи/итогов (ставятся на meeting.ended). Фронт по ним
  // отличает «формируется» от «недоступно по таймауту». Не чувствительны — видны всем.
  recordingRequestedAt: Date | null;
  summaryRequestedAt: Date | null;
  // Транскрипт занятия (Ф1.3/Ф1.4). Статус/ошибка/момент ожидания — для препода
  // урока/админа; тело (ключи .vtt/.txt) НИКОГДА не отдаём в проекции — только через
  // GET .../transcript.
  transcriptStatus: string | null;
  transcriptError: string | null;
  transcriptRequestedAt: Date | null;
} | null;

// Преобразует пару (блок урока, его Session в контексте потока) к ПЛОСКОЙ форме
// урока для фронта (как было в старой модели):
//   - все поля блока (id/title/videoUrl/videoKey/summary/notes/materials/sortOrder
//     + folded assignment*),
//   - teachers → [{id,name}],
//   - streamId — контекст потока (или null вне потока),
//   - status/date/startTime/meetingUrl — из Session (если Session нет: draft / null),
//   - видео: учебное (videoKey/videoUrl/videos[]) — СТРОГО из блока (грузится до урока);
//     запись Zoom-занятия — в ОТДЕЛЬНЫЕ поля recordingVideoKey/recordingVideoUrl
//     (из Session, подтягивается после). Это разные сущности, запись не перетирает учебное.
// materials/videoFileUrl/recordingFileUrl ре-подписываются вызывающим (они асинхронные).
// Экспортируется для unit-тестов проекции (в частности admin-only recordingError).
export function projectLesson(
  block: LessonBlock,
  streamId: string | null,
  session: SessionProjection,
  // recordingError — деталь для админа (текст ошибки автозагрузки). Студентам не
  // отдаём (раскрывает внутренности обработки), поэтому для не-админа зануляем.
  // По умолчанию true: admin-only роуты (POST/PATCH) не меняют поведение.
  isAdmin = true,
  // canSeeTranscript — может ли получатель видеть транскрипт занятия (админ ИЛИ
  // преподаватель урока). Студенту транскрипт НЕДОСТУПЕН: его поля (статус/ошибка)
  // ИСКЛЮЧАЮТСЯ из объекта проекции целиком (не зануляются). Тело транскрипта в
  // проекции не отдаётся НИКОГДА — только через GET .../transcript. По умолчанию
  // совпадает с isAdmin (admin-only роуты сохраняют прежнее поведение).
  canSeeTranscript = isAdmin,
): {
  id: string;
  streamId: string | null;
  title: string;
  videoUrl: string | null;
  videoKey: string | null;
  summary: string | null;
  notes: string | null;
  status: LessonStatusValue;
  date: string | null;
  startTime: string | null;
  meetingUrl: string | null;
  sortOrder: number;
  hasAssignment: boolean;
  assignmentTitle: string | null;
  assignmentDescription: string | null;
  assignmentCriteria: string | null;
  assignmentType: 'short' | 'long' | null;
  assignmentTags: string[];
  assignmentMaterials: unknown;
  createdAt: Date;
  updatedAt: Date;
  teachers: { id: string; name: string }[];
  // Запись Zoom-занятия (Session). Отдельная сущность от учебного видео урока
  // (block.videoKey/videoUrl/videos[]): учебное грузится ДО урока, запись —
  // подтягивается ПОСЛЕ. Аддитивно: вне потока или без записи — null.
  recordingVideoKey: string | null;
  recordingVideoUrl: string | null;
  // Автосбор записи/итогов Zoom (Волна 2). Аддитивно: для уроков без Session
  // или со старыми данными — null, поведение не меняется.
  recordingStatus: string | null;
  recordingError: string | null;
  summarySource: string | null;
  // Статус итогов (none|pending|processing|ready|failed). Студенту виден (это про
  // готовность итогов, не про доступ к транскрипту).
  summaryStatus: string | null;
  // Моменты начала ожидания записи/итогов — видны всем (как recording/summaryStatus).
  // Фронт по ним отличает «формируется» (ждём недолго) от «недоступно по таймауту».
  recordingRequestedAt: string | null;
  summaryRequestedAt: string | null;
  // Статус/ошибка/момент ожидания транскрипта (Ф1.4) — ТОЛЬКО для препода урока/админа.
  // Поля ОПЦИОНАЛЬНЫ: при canSeeTranscript=false их в объекте НЕТ вовсе (см. ниже).
  transcriptStatus?: string | null;
  transcriptError?: string | null;
  transcriptRequestedAt?: string | null;
} {
  // Учебное видео урока (block): грузится ДО урока, не перетирается записью занятия.
  const videoKey = block.videoKey;
  const videoUrl = block.videoUrl;
  // Запись Zoom-занятия (Session): отдельные поля, подтягивается ПОСЛЕ урока.
  const recordingVideoKey = session?.videoKey ?? null;
  const recordingVideoUrl = session?.videoUrl ?? null;
  const date = session?.date ?? null;

  return {
    id: block.id,
    streamId,
    title: block.title,
    videoUrl,
    videoKey,
    // Итоги конкретного занятия (Session.summary) приоритетнее блочных
    // (Lesson.summary). Для старых данных Session.summary = null → блочное.
    summary: session?.summary ?? block.summary,
    notes: block.notes,
    status: session?.status ?? 'draft',
    date: date ? date.toISOString().slice(0, 10) : null,
    startTime: session?.startTime ?? null,
    meetingUrl: session?.meetingUrl ?? null,
    sortOrder: block.sortOrder,
    hasAssignment: block.hasAssignment,
    assignmentTitle: block.assignmentTitle,
    assignmentDescription: block.assignmentDescription,
    assignmentCriteria: block.assignmentCriteria,
    assignmentType: block.assignmentType,
    assignmentTags: block.assignmentTags ?? [],
    assignmentMaterials: block.assignmentMaterials ?? [],
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    teachers: (block.teachers ?? []).map((t) => ({ id: t.user.id, name: t.user.name })),
    // Запись Zoom-занятия — отдельно от учебного видео урока.
    recordingVideoKey,
    recordingVideoUrl,
    // Статус автозагрузки записи Zoom и источник итогов (для UI). Вне потока
    // (Session нет) — null, как и для занятий без созвона Zoom.
    recordingStatus: session?.recordingStatus ?? null,
    // recordingError — только админам (текст ошибки чувствителен); студенту — null.
    recordingError: isAdmin ? session?.recordingError ?? null : null,
    summarySource: session?.summarySource ?? null,
    // Статус итогов — виден всем (про готовность, не про доступ к телу).
    summaryStatus: session?.summaryStatus ?? null,
    // Моменты ожидания записи/итогов — видны всем (как и их статусы). ISO-строкой
    // (как date), чтобы фронт мог посчитать прошедшее время до таймаута.
    recordingRequestedAt: session?.recordingRequestedAt
      ? session.recordingRequestedAt.toISOString()
      : null,
    summaryRequestedAt: session?.summaryRequestedAt
      ? session.summaryRequestedAt.toISOString()
      : null,
    // Транскрипт: его поля присутствуют ТОЛЬКО когда получатель вправе их видеть
    // (админ/препод урока). Для студента ключи transcriptStatus/transcriptError/
    // transcriptRequestedAt ОТСУТСТВУЮТ в объекте (исключены, а не занулены) — чтобы
    // факт/статус/ошибка транскрипта не утекали (момент ожидания держим за тем же
    // гейтом для единообразия). Тело (ключи S3) тут не отдаём вовсе.
    ...(canSeeTranscript
      ? {
          transcriptStatus: session?.transcriptStatus ?? null,
          transcriptError: session?.transcriptError ?? null,
          transcriptRequestedAt: session?.transcriptRequestedAt
            ? session.transcriptRequestedAt.toISOString()
            : null,
        }
      : {}),
  };
}

// Достраивает спроецированный урок асинхронными полями (videoFileUrl +
// recordingFileUrl + ре-подписанные materials). Учебное videoKey и запись
// recordingVideoKey разведены в projectLesson — подписываем их раздельно.
async function finalizeLesson(
  projected: ReturnType<typeof projectLesson>,
  block: LessonBlock,
  // Контекст получателя для изоляции материалов/видео по потоку. По умолчанию —
  // админский (без сужения), чтобы admin-only роуты POST/PATCH не менялись.
  ctx: MaterialVisibilityContext = ADMIN_VISIBILITY,
): Promise<Record<string, unknown> & { recordingFileUrl: string | null }> {
  // Учебное видео урока (block.videoKey) — легаси-метод, общий, отдаём как раньше.
  const videoFileUrl = await videoFileUrlFor(projected.videoKey);
  // Запись Zoom-занятия (Session.videoKey) — отдельная подпись.
  const recordingFileUrl = await videoFileUrlFor(projected.recordingVideoKey);
  // Материалы: студенту — только общие + своего потока (чужие отброшены до подписи).
  const materials = await regenerateLessonMaterialUrls(
    (block.materials as unknown as LessonMaterial[]) || [],
    ctx,
  );
  // Аддитивно: список из нескольких видео урока (одиночные videoUrl/videoFileUrl сохранены).
  // Студенту — только общие + своего потока.
  const videos = await projectVideos(block.videos, ctx);
  return { ...projected, videoFileUrl, recordingFileUrl, materials, videos };
}

// Является ли пользователь преподавателем урока (LessonTeacher.some(userId)).
// Используется для гейтинга транскрипта (наряду с ролью admin). Возвращает false
// для отсутствующего userId.
async function isLessonTeacher(lessonId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const link = await prisma.lessonTeacher.findFirst({
    where: { lessonId, userId },
    select: { userId: true },
  });
  return link !== null;
}

// Определяет teacherUserId (под чьим OAuth-токеном дёргать Zoom) каскадом фолбэков
// для ручных операций из роута: 1) преподаватель урока с рабочей интеграцией;
// 2) текущий пользователь (админ), если у него canCreateMeeting; 3) фолбэк на него
// же без проверки (lib безопасно зафиксирует ошибку токена). Реальный владелец
// встречи в БД не хранится, поэтому без каскада не обойтись (см. recording/retry).
async function resolveTeacherForZoom(
  lessonId: string,
  fallbackUserId: string,
): Promise<string> {
  const teachers = await prisma.lessonTeacher.findMany({
    where: { lessonId },
    select: { userId: true },
  });
  for (const t of teachers) {
    if (await canCreateMeeting(t.userId)) return t.userId;
  }
  if (await canCreateMeeting(fallbackUserId)) return fallbackUserId;
  return fallbackUserId;
}

// Оставляет из переданных id только существующих не удалённых пользователей с ролью admin
async function filterAdminIds(teacherIds: string[]): Promise<string[]> {
  const unique = [...new Set(teacherIds.filter((id) => typeof id === 'string'))];
  if (unique.length === 0) return [];
  const admins = await prisma.user.findMany({
    where: { id: { in: unique }, role: 'admin', deletedAt: null },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

// Поля Session, проецируемые в форму урока.
const sessionSelect = {
  status: true,
  date: true,
  startTime: true,
  meetingUrl: true,
  videoUrl: true,
  videoKey: true,
  // Итоги занятия + автосбор записи Zoom (Волна 2).
  summary: true,
  summarySource: true,
  summaryStatus: true,
  recordingStatus: true,
  recordingError: true,
  // Моменты начала ожидания записи/итогов (для отличия «формируется» от «таймаут»).
  recordingRequestedAt: true,
  summaryRequestedAt: true,
  // Транскрипт занятия (Ф1.3/Ф1.4) — статус/ошибка/момент ожидания. Ключи .vtt/.txt
  // тут НЕ селектим в общую проекцию: тело отдаётся только через GET .../transcript.
  transcriptStatus: true,
  transcriptError: true,
  transcriptRequestedAt: true,
} as const;

export async function lessonRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');
  const anyAuth = authenticate;

  // onRequest-гард: пропускает админа ИЛИ преподавателя урока (LessonTeacher).
  // lessonId берём из params.id (так названы все эти роуты). Сначала authenticate
  // (заполняет request.user), затем проверка роли/преподавательства. Применяется к
  // операциям над конкретным занятием (refresh, transcript, recording/retry), где
  // право должно быть и у преподавателя урока, а не только у админа.
  const lessonTeacherOrAdmin = async (
    request: Parameters<typeof authenticate>[0],
    reply: Parameters<typeof authenticate>[1],
  ) => {
    await authenticate(request, reply);
    if (reply.sent) return; // authenticate уже ответил 401
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ error: 'Не авторизован' });
    }
    if (user.role === 'admin') return; // админ — всегда можно
    const { id } = request.params as { id: string };
    if (await isLessonTeacher(id, user.userId)) return;
    return reply.status(403).send({ error: 'Недостаточно прав' });
  };

  // GET /lessons?streamId=xxx&mine=true — список уроков (опциональная фильтрация по streamId)
  //
  // С streamId: уроки потока в порядке программы (ProgramLesson.sortOrder), к каждому
  //   присоединена его Session (status/date/startTime/meetingUrl/видео). Менторские
  //   потоки (program = null) используют свои Session напрямую.
  // Без streamId (admin «Все потоки» / копилка блоков): все блоки уроков как черновики
  //   без контекста потока.
  // Admin: все (или только свои при ?mine=true). Student: только недрафтовые уроки
  //   своих потоков.
  app.get('/lessons', { onRequest: anyAuth }, async (request, reply) => {
    const { streamId, mine } = request.query as { streamId?: string; mine?: string };
    const isAdmin = request.user?.role === 'admin';

    // ── Без streamId: копилка блоков (только admin видит без потока) ──────────
    if (!streamId) {
      const isMine = isAdmin && mine === 'true';
      const blocks = await prisma.lesson.findMany({
        where: {
          ...(isMine && { teachers: { some: { userId: request.user!.userId } } }),
        },
        include: teacherInclude,
        orderBy: { sortOrder: 'asc' },
      });

      // Студент без потока не должен видеть черновики; блоки в этом виде всегда draft,
      // поэтому для не-админа отдаём пустой список (как и старое поведение: студент
      // без streamId не получал видимых уроков).
      const visible = isAdmin ? blocks : [];

      const shaped = await Promise.all(
        // Копилка блоков видна только админу (visible пуст для не-админа), поэтому
        // canSeeTranscript=isAdmin безопасно (студент сюда не попадает).
        visible.map((block) =>
          finalizeLesson(projectLesson(block, null, null, isAdmin, isAdmin), block),
        ),
      );
      return { lessons: shaped };
    }

    // ── С streamId ────────────────────────────────────────────────────────────
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true, name: true, programId: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    // Студент видит уроки только своих потоков
    if (!isAdmin && !(await isEnrolled(request.user!.userId, streamId))) {
      return reply.status(403).send({ error: 'Нет доступа к этой группе' });
    }

    const isMine = isAdmin && mine === 'true';

    // Контекст изоляции материалов/видео: streamId известен заранее. Для студента
    // видео фильтруются на уровне SQL (where в include видео опирается на индекс
    // [lessonId, streamId]; Prisma делает один батч-запрос по всем урокам — без N+1).
    const ctx: MaterialVisibilityContext = { viewerStreamId: streamId, isAdmin };
    const blockInclude = teacherIncludeFor(ctx);

    // Загружаем все Session потока разом → карта lessonId → Session.
    const sessions = await prisma.session.findMany({
      where: { streamId },
      select: { lessonId: true, ...sessionSelect },
    });
    const sessionByLesson = new Map(sessions.map((s) => [s.lessonId, s]));

    // Упорядоченный список уроков потока:
    //   - если у потока есть Program → из ProgramLesson (orderBy sortOrder);
    //   - иначе (менторский) → из самих Session потока.
    let orderedBlocks: LessonBlock[];

    if (stream.programId) {
      const programLessons = await prisma.programLesson.findMany({
        where: { programId: stream.programId },
        orderBy: { sortOrder: 'asc' },
        include: { lesson: { include: blockInclude } },
      });
      orderedBlocks = programLessons.map((pl) => pl.lesson as unknown as LessonBlock);
    } else {
      // Менторский поток: уроки = уроки его Session.
      const sessionLessons = await prisma.session.findMany({
        where: { streamId },
        include: { lesson: { include: blockInclude } },
        orderBy: { lesson: { sortOrder: 'asc' } },
      });
      orderedBlocks = sessionLessons.map((s) => s.lesson as unknown as LessonBlock);
    }

    // Фильтр «только мои» (admin): уроки, где есть текущий преподаватель.
    if (isMine) {
      orderedBlocks = orderedBlocks.filter((b) =>
        (b.teachers ?? []).some((t) => t.user.id === request.user!.userId),
      );
    }

    // Студент не видит черновики: убираем уроки, чья Session отсутствует или draft.
    const visibleBlocks = isAdmin
      ? orderedBlocks
      : orderedBlocks.filter((b) => {
          const s = sessionByLesson.get(b.id);
          return s && s.status !== 'draft';
        });

    const currentUserId = request.user?.userId;
    const shaped = await Promise.all(
      visibleBlocks.map((block) => {
        const s = sessionByLesson.get(block.id) ?? null;
        // Транскрипт виден админу ИЛИ преподавателю этого урока. teachers уже
        // подгружены в блок (teacherInclude) — проверяем без доп. запроса. Для
        // студента это всегда false (он не числится в LessonTeacher).
        const canSeeTranscript =
          isAdmin ||
          (block.teachers ?? []).some((t) => t.user.id === currentUserId);
        const projected = projectLesson(
          block,
          streamId,
          s as SessionProjection,
          isAdmin,
          canSeeTranscript,
        );
        return finalizeLesson(projected, block, ctx).then((full) => ({
          ...full,
          // Контекст потока для режима «Все потоки» / бейджей.
          stream: { id: stream.id, name: stream.name },
        }));
      }),
    );

    return { lessons: shaped };
  });

  // GET /lessons/:id (+ опциональный ?streamId) — получить блок урока.
  // Если задан streamId — присоединяем Session этого потока (status/date/видео).
  // Студент: доступ только если зачислен в какой-то поток, программа/Session которого
  //   содержит этот урок, и урок в том потоке не черновик.
  app.get('/lessons/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { streamId } = request.query as { streamId?: string };

    const block = (await prisma.lesson.findUnique({
      where: { id },
      include: teacherInclude,
    })) as unknown as LessonBlock | null;

    if (!block) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const isAdmin = request.user?.role === 'admin';

    // Определяем поток-контекст и его Session для проекции расписания.
    // Для студента — выбираем поток, в котором он зачислён и где урок виден.
    let contextStreamId: string | null = null;
    let session: SessionProjection = null;

    if (isAdmin) {
      // Админ: если задан streamId — берём его Session; иначе блок без расписания.
      if (streamId) {
        const s = await prisma.session.findUnique({
          where: { streamId_lessonId: { streamId, lessonId: id } },
          select: sessionSelect,
        });
        contextStreamId = streamId;
        session = (s as SessionProjection) ?? null;
      }
    } else {
      const userId = request.user!.userId;

      // Кандидаты потоков, где этот урок присутствует (через программу или Session)
      // и где студент зачислён. Среди них берём первый недрафтовый.
      // Сначала — Session потоков, где зачислен студент.
      const enrolledStreamIds = (
        await prisma.streamEnrollment.findMany({
          where: { userId },
          select: { streamId: true },
        })
      ).map((e) => e.streamId);

      if (enrolledStreamIds.length === 0) {
        return reply.status(404).send({ error: 'Урок не найден' });
      }

      // Приоритет — у явно переданного streamId (это активный таб студента на фронте).
      // Если фронт прислал streamId — сужаем кандидатов ТОЛЬКО до него (при условии,
      // что студент в нём зачислён). Если переданный streamId невалиден (студент в нём
      // не состоит) — candidateStreamIds окажется пустым → 404 ниже: чужой поток НЕ
      // подставляется молча, контент чужого потока не утекает.
      // Если streamId не передан — это лишь ДЕФОЛТ-таб; перебираем все потоки студента,
      // но детерминированно (см. orderBy ниже). Основной путь — явный streamId с фронта.
      const candidateStreamIds = streamId
        ? enrolledStreamIds.filter((sid) => sid === streamId)
        : enrolledStreamIds;

      if (candidateStreamIds.length === 0) {
        return reply.status(404).send({ error: 'Урок не найден' });
      }

      // Session этого урока в потоках студента (несут видимость/расписание).
      // orderBy обязателен: без него порядок findMany не определён, и при отсутствии
      // streamId выбор «первого недрафтового» был бы недетерминированным — студент в
      // двух потоках мог получить контекст случайного потока (баг #158). Сортируем по
      // createdAt (а потом по streamId как тай-брейк), чтобы дефолт-таб был стабильным.
      // Когда streamId передан валидно — кандидат ровно один, выбор однозначен.
      const candidateSessions = await prisma.session.findMany({
        where: { lessonId: id, streamId: { in: candidateStreamIds } },
        select: { streamId: true, ...sessionSelect },
        orderBy: [{ createdAt: 'asc' }, { streamId: 'asc' }],
      });

      // Студенту виден урок только через недрафтовую Session. При переданном streamId
      // кандидат один — если его Session черновик/отсутствует, visibleSession === null
      // → 404 (не отдаём контент потока, недоступного студенту по этому уроку).
      const visibleSession =
        candidateSessions.find((s) => s.status !== 'draft') ?? null;

      if (!visibleSession) {
        return reply.status(404).send({ error: 'Урок не найден' });
      }

      contextStreamId = visibleSession.streamId;
      session = visibleSession as SessionProjection;
    }

    // Транскрипт виден админу ИЛИ преподавателю этого урока (teachers подгружены
    // в block через teacherInclude — без доп. запроса). Для студента всегда false.
    const canSeeTranscript =
      isAdmin ||
      (block.teachers ?? []).some((t) => t.user.id === request.user?.userId);

    // Контекст изоляции: для студента — его поток-контекст (contextStreamId), для
    // админа — без сужения. block грузился с видео через teacherInclude (все видео).
    // Для студента перевыбираем видео на уровне SQL по индексу [lessonId, streamId]
    // (общие + своего потока), чтобы чужие видео не попадали в выборку/проекцию.
    const ctx: MaterialVisibilityContext = { viewerStreamId: contextStreamId, isAdmin };
    if (!isAdmin) {
      const where = videoWhereFor(ctx);
      block.videos = (await prisma.lessonVideo.findMany({
        where: { lessonId: id, ...(where ?? {}) },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })) as unknown as LessonBlock['videos'];
    }

    const projected = projectLesson(block, contextStreamId, session, isAdmin, canSeeTranscript);
    const full = await finalizeLesson(projected, block, ctx);

    // Старый ответ включал lesson.assignments (массив). В новой модели у блока —
    // folded assignment*-поля (уже в full), а отдельной сущности Assignment нет.
    // Сохраняем ключ assignments как пустой массив, чтобы фронт не падал на
    // `data.assignments.length`.
    return { lesson: { ...full, assignments: [] } };
  });

  // POST /lessons — создание урока (admin).
  // streamId ОПЦИОНАЛЕН:
  //   - без streamId — создаём только БЛОК урока (копилка): без ProgramLesson и без
  //     Session; возвращаем спроецированный урок (streamId=null, status='draft').
  //   - с streamId — привязываем блок к программе потока (ProgramLesson, если у потока
  //     есть Program) и заводим/обновляем Session (status/date/startTime/meetingUrl).
  // Возвращает спроецированный урок.
  app.post('/lessons', { onRequest: adminOnly }, async (request, reply) => {
    const body = request.body as {
      streamId?: string;
      title: string;
      videoUrl?: string;
      summary?: string;
      notes?: string;
      status?: string;
      date?: string | null;
      startTime?: string | null;
      meetingUrl?: string | null;
      sortOrder?: number;
      teacherIds?: string[];
      materials?: LessonMaterial[];
      // Сгенерировать ссылку Zoom по запросу фронта (независимо от глобального
      // тумблера autoCreateMeeting). undefined — поведение по тумблеру.
      generateMeeting?: boolean;
      // folded assignment*-поля блока (аддитивно — те же, что у PATCH). Срабатывают
      // только если переданы; веб-флоу «Создать урок» их не шлёт.
      hasAssignment?: boolean;
      assignmentTitle?: string | null;
      assignmentDescription?: string | null;
      assignmentCriteria?: string | null;
      assignmentType?: 'short' | 'long' | null;
      assignmentTags?: string[];
      assignmentMaterials?: unknown;
    };

    if (!body.title || !body.title.trim()) {
      return reply.status(400).send({ error: 'Название урока обязательно' });
    }

    if (body.generateMeeting !== undefined && typeof body.generateMeeting !== 'boolean') {
      return reply.status(400).send({ error: 'Поле generateMeeting должно быть булевым' });
    }

    if (body.status !== undefined && !isLessonStatus(body.status)) {
      return reply.status(400).send({ error: 'Недопустимый статус' });
    }

    if (
      body.assignmentType !== undefined &&
      body.assignmentType !== null &&
      body.assignmentType !== 'short' &&
      body.assignmentType !== 'long'
    ) {
      return reply.status(400).send({ error: 'Тип задания: short или long' });
    }

    const status: LessonStatusValue = isLessonStatus(body.status) ? body.status : 'draft';
    const date = parseLessonDate(body.date);

    const teacherIds = Array.isArray(body.teacherIds)
      ? await filterAdminIds(body.teacherIds)
      : [];

    // folded assignment*-поля блока: собираем только переданные (аддитивно). Нормализация
    // как в PATCH /lessons (пустые строки → null, assignmentMaterials через JSON-копию).
    // Пишем в data.create блока в обеих ветках (с streamId и без).
    const assignmentData: Record<string, unknown> = {};
    if (body.hasAssignment !== undefined) assignmentData.hasAssignment = body.hasAssignment;
    if (body.assignmentTitle !== undefined)
      assignmentData.assignmentTitle = body.assignmentTitle || null;
    if (body.assignmentDescription !== undefined)
      assignmentData.assignmentDescription = body.assignmentDescription || null;
    if (body.assignmentCriteria !== undefined)
      assignmentData.assignmentCriteria = body.assignmentCriteria || null;
    if (body.assignmentType !== undefined) assignmentData.assignmentType = body.assignmentType;
    if (body.assignmentTags !== undefined) assignmentData.assignmentTags = body.assignmentTags;
    if (body.assignmentMaterials !== undefined) {
      assignmentData.assignmentMaterials = JSON.parse(
        JSON.stringify(body.assignmentMaterials ?? []),
      );
    }

    // ── Без streamId: создаём только блок-урок (копилка) ──────────────────────
    if (!body.streamId) {
      const block = (await prisma.lesson.create({
        data: {
          title: body.title.trim(),
          videoUrl: body.videoUrl?.trim() || null,
          summary: body.summary || null,
          notes: body.notes || null,
          sortOrder: body.sortOrder ?? 0,
          materials: JSON.parse(JSON.stringify(sanitizeLessonMaterials(body.materials))),
          ...assignmentData,
          ...(teacherIds.length > 0 && {
            teachers: { create: teacherIds.map((userId) => ({ userId })) },
          }),
        },
        include: teacherInclude,
      })) as unknown as LessonBlock;

      // Блок без потока: streamId=null, status='draft' (нет Session).
      const projected = projectLesson(block, null, null);
      return reply.status(201).send({ lesson: projected });
    }

    // ── С streamId: блок + (ProgramLesson) + Session ──────────────────────────

    // «Запланирован» требует даты
    if (status === 'planned' && !date) {
      return reply.status(400).send({ error: 'Запланированному уроку нужна дата' });
    }

    // «Запланирован» требует и время начала — без момента старта планировщик не
    // соберёт UTC-инстант для напоминаний за 60/15 мин (issue #169, техдизайн §6).
    if (status === 'planned' && !body.startTime?.trim()) {
      return reply.status(400).send({ error: 'Запланированному занятию нужно время начала' });
    }
    // Формат времени строго HH:MM (00:00–23:59): кривое значение (напр. "9 утра",
    // "25:99") иначе пройдёт проверку непустоты, а планировщик напоминаний не
    // соберёт момент старта → напоминание тихо не уйдёт (issue #169, находка ревью).
    if (body.startTime?.trim() && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.startTime.trim())) {
      return reply.status(400).send({ error: 'Некорректное время (ожидается HH:MM)' });
    }

    const stream = await prisma.stream.findUnique({
      where: { id: body.streamId },
      select: { id: true, status: true, programId: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    if (stream.status === 'archived') {
      return reply.status(400).send({ error: 'Нельзя добавлять уроки в архивную группу' });
    }

    // 1) Создаём блок урока.
    const block = (await prisma.lesson.create({
      data: {
        title: body.title.trim(),
        videoUrl: body.videoUrl?.trim() || null,
        summary: body.summary || null,
        notes: body.notes || null,
        sortOrder: body.sortOrder ?? 0,
        materials: JSON.parse(JSON.stringify(sanitizeLessonMaterials(body.materials))),
        ...assignmentData,
        ...(teacherIds.length > 0 && {
          teachers: { create: teacherIds.map((userId) => ({ userId })) },
        }),
      },
      include: teacherInclude,
    })) as unknown as LessonBlock;

    // 2) Привязка к программе потока (если поток курсовой/интенсив — есть Program).
    //    Менторский поток (programId = null) — без ProgramLesson.
    if (stream.programId) {
      const existing = await prisma.programLesson.findUnique({
        where: { programId_lessonId: { programId: stream.programId, lessonId: block.id } },
        select: { id: true },
      });
      if (!existing) {
        const last = await prisma.programLesson.findFirst({
          where: { programId: stream.programId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        await prisma.programLesson.create({
          data: {
            programId: stream.programId,
            lessonId: block.id,
            sortOrder: (last?.sortOrder ?? -1) + 1,
          },
        });
      }
    }

    // Создание встречи Zoom: только если дата задана, ручной meetingUrl не передан
    // и Session ещё нет (новый блок — сохранённой ссылки тоже нет). generateMeeting
    // позволяет сгенерировать ссылку по запросу даже при выключенном тумблере.
    // Ошибки Zoom не валят планирование (см. maybeCreateMeetingUrl).
    const autoMeeting = await maybeCreateMeetingUrl(app, request.user!.userId, {
      date,
      startTime: body.startTime,
      bodyMeetingUrl: body.meetingUrl,
      existingMeetingUrl: null,
      topic: block.title,
      generateMeeting: body.generateMeeting,
    });
    const meetingUrl = body.meetingUrl?.trim() || autoMeeting?.joinUrl || null;
    // zoomMeetingId сохраняем только когда встречу реально создали через Zoom.
    const zoomMeetingId = autoMeeting?.meetingId ?? null;

    // 3) Session потока несёт расписание/статус/видео.
    const session = await prisma.session.upsert({
      where: { streamId_lessonId: { streamId: body.streamId, lessonId: block.id } },
      create: {
        streamId: body.streamId,
        lessonId: block.id,
        status,
        date,
        startTime: body.startTime?.trim() || null,
        meetingUrl,
        ...(zoomMeetingId ? { zoomMeetingId } : {}),
      },
      update: {
        status,
        date,
        startTime: body.startTime?.trim() || null,
        meetingUrl,
        ...(zoomMeetingId ? { zoomMeetingId } : {}),
      },
      select: sessionSelect,
    });

    // Уведомляем учеников, если урок создан сразу видимым (не черновик)
    if (status !== 'draft') {
      notifyEnrolledLessonVisible(block.id, body.streamId, block.title).catch(() => {});
    }

    const projected = projectLesson(block, body.streamId, session as SessionProjection);
    return reply.status(201).send({ lesson: projected });
  });

  // PATCH /lessons/:id — обновление урока (admin).
  // Поля блока (title/notes/sortOrder/videoUrl/teacherIds/materials +
  //   assignment*) → обновляют Lesson.
  // Поля расписания (status/date/startTime/meetingUrl) → если задан streamId,
  //   upsert/update Session(streamId, lessonId); без streamId — игнорируются
  //   (правка только блока). Возвращает спроецированный урок.
  // summary — особый случай: С streamId это итоги КОНКРЕТНОГО занятия → пишем в
  //   Session.summary + summarySource='manual' (ручной ввод приоритетнее Zoom AI,
  //   автосбор его не перетирает). БЕЗ streamId — это блочное описание урока →
  //   пишем в Lesson.summary, как раньше (редактор урока-блока).
  app.patch('/lessons/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      streamId?: string;
      title?: string;
      videoUrl?: string;
      summary?: string;
      notes?: string;
      status?: string;
      date?: string | null;
      startTime?: string | null;
      meetingUrl?: string | null;
      sortOrder?: number;
      teacherIds?: string[];
      materials?: LessonMaterial[];
      // Сгенерировать ссылку Zoom по запросу фронта (независимо от глобального
      // тумблера autoCreateMeeting). undefined — поведение по тумблеру.
      generateMeeting?: boolean;
      // folded assignment* поля блока
      hasAssignment?: boolean;
      assignmentTitle?: string | null;
      assignmentDescription?: string | null;
      assignmentCriteria?: string | null;
      assignmentType?: 'short' | 'long' | null;
      assignmentTags?: string[];
      assignmentMaterials?: unknown;
    };

    const existing = (await prisma.lesson.findUnique({
      where: { id },
      include: teacherInclude,
    })) as unknown as LessonBlock | null;
    if (!existing) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    if (body.title !== undefined && !body.title.trim()) {
      return reply.status(400).send({ error: 'Название урока не может быть пустым' });
    }

    if (body.status !== undefined && !isLessonStatus(body.status)) {
      return reply.status(400).send({ error: 'Недопустимый статус' });
    }

    if (body.generateMeeting !== undefined && typeof body.generateMeeting !== 'boolean') {
      return reply.status(400).send({ error: 'Поле generateMeeting должно быть булевым' });
    }

    // Контекст потока для расписания (Session). Без него поля расписания игнорируем.
    const streamId = body.streamId;
    // Запрос на генерацию встречи (generateMeeting === true) тоже трогает Session:
    // нужно зайти в ветку upsert даже если расписание не меняли (например, дата уже
    // сохранена, а ссылку просят создать сейчас). Явный отказ (false) Session не трогает.
    // summary с streamId — правка итогов занятия: тоже трогает Session.
    const scheduleTouched =
      body.status !== undefined ||
      body.date !== undefined ||
      body.startTime !== undefined ||
      body.meetingUrl !== undefined ||
      body.summary !== undefined ||
      body.generateMeeting === true;

    // Текущая Session (если есть streamId) — нужна для проекции и правила planned→date.
    let existingSession: SessionProjection = null;
    if (streamId) {
      existingSession = (await prisma.session.findUnique({
        where: { streamId_lessonId: { streamId, lessonId: id } },
        select: sessionSelect,
      })) as SessionProjection;
    }

    // Правило «planned требует даты» проверяем по итоговому состоянию Session.
    if (streamId && scheduleTouched) {
      const nextStatus: LessonStatusValue = isLessonStatus(body.status)
        ? body.status
        : (existingSession?.status ?? 'draft');
      const nextDate =
        body.date !== undefined ? parseLessonDate(body.date) : existingSession?.date ?? null;
      if (nextStatus === 'planned' && !nextDate) {
        return reply.status(400).send({ error: 'Запланированному уроку нужна дата' });
      }
      // Время начала тоже обязательно для запланированного занятия (issue #169):
      // момент старта нужен планировщику напоминаний (date + startTime → UTC-инстант).
      const nextStartTimeForCheck =
        body.startTime !== undefined
          ? body.startTime?.trim() || null
          : existingSession?.startTime ?? null;
      if (nextStatus === 'planned' && !nextStartTimeForCheck) {
        return reply.status(400).send({ error: 'Запланированному занятию нужно время начала' });
      }
      // Формат HH:MM (если время передаётся в этом PATCH) — иначе планировщик
      // напоминаний не соберёт момент старта (issue #169, находка ревью).
      if (
        body.startTime !== undefined &&
        body.startTime?.trim() &&
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.startTime.trim())
      ) {
        return reply.status(400).send({ error: 'Некорректное время (ожидается HH:MM)' });
      }
    }

    // ── Обновление полей блока ──────────────────────────────────────────────
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.videoUrl !== undefined) data.videoUrl = body.videoUrl.trim() || null;
    // summary с streamId уходит в Session (итоги занятия), а не в блок — см. ниже.
    if (body.summary !== undefined && !streamId) data.summary = body.summary || null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.materials !== undefined) {
      data.materials = JSON.parse(JSON.stringify(sanitizeLessonMaterials(body.materials)));
    }
    // folded assignment*-поля блока
    if (body.hasAssignment !== undefined) data.hasAssignment = body.hasAssignment;
    if (body.assignmentTitle !== undefined) data.assignmentTitle = body.assignmentTitle || null;
    if (body.assignmentDescription !== undefined)
      data.assignmentDescription = body.assignmentDescription || null;
    if (body.assignmentCriteria !== undefined)
      data.assignmentCriteria = body.assignmentCriteria || null;
    if (body.assignmentType !== undefined) data.assignmentType = body.assignmentType;
    if (body.assignmentTags !== undefined) data.assignmentTags = body.assignmentTags;
    if (body.assignmentMaterials !== undefined) {
      data.assignmentMaterials = JSON.parse(JSON.stringify(body.assignmentMaterials ?? []));
    }

    // Замена набора преподавателей: удаляем текущие, создаём новые (только admin)
    if (body.teacherIds !== undefined) {
      const teacherIds = Array.isArray(body.teacherIds)
        ? await filterAdminIds(body.teacherIds)
        : [];
      await prisma.$transaction([
        prisma.lessonTeacher.deleteMany({ where: { lessonId: id } }),
        ...(teacherIds.length > 0
          ? [
              prisma.lessonTeacher.createMany({
                data: teacherIds.map((userId) => ({ lessonId: id, userId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    const block = (await prisma.lesson.update({
      where: { id },
      data,
      include: teacherInclude,
    })) as unknown as LessonBlock;

    // ── Обновление расписания (Session) — только если задан streamId ─────────
    let session: SessionProjection = existingSession;
    if (streamId && scheduleTouched) {
      // Итоговая дата занятия после правки (для проверки и автосоздания встречи).
      const nextDate =
        body.date !== undefined ? parseLessonDate(body.date) : existingSession?.date ?? null;
      // Итоговое время начала (для start_time встречи).
      const nextStartTime =
        body.startTime !== undefined
          ? body.startTime?.trim() || null
          : existingSession?.startTime ?? null;

      // Создание встречи Zoom: дата задана, ручной meetingUrl не передан и у занятия
      // ещё нет сохранённой ссылки (не перезатираем ручную/существующую). Не создаём
      // новый митинг на каждый PATCH — только когда ссылки нет. generateMeeting
      // позволяет сгенерировать ссылку по запросу даже при выключенном тумблере.
      const autoMeeting = await maybeCreateMeetingUrl(app, request.user!.userId, {
        date: nextDate,
        startTime: nextStartTime,
        bodyMeetingUrl: body.meetingUrl,
        existingMeetingUrl: existingSession?.meetingUrl ?? null,
        topic: block.title,
        generateMeeting: body.generateMeeting,
      });

      const sessionUpdate: Record<string, unknown> = {};
      if (body.status !== undefined) sessionUpdate.status = body.status;
      if (body.date !== undefined) sessionUpdate.date = parseLessonDate(body.date);
      if (body.startTime !== undefined) sessionUpdate.startTime = body.startTime?.trim() || null;
      // Ручные итоги занятия: пишем в Session.summary и помечаем источник 'manual',
      // чтобы автосбор Zoom AI их не перезатёр (см. processSummaryForSession).
      if (body.summary !== undefined) {
        sessionUpdate.summary = body.summary?.trim() || null;
        sessionUpdate.summarySource = 'manual';
      }
      if (body.meetingUrl !== undefined) {
        sessionUpdate.meetingUrl = body.meetingUrl?.trim() || null;
      } else if (autoMeeting) {
        // meetingUrl не трогали явно, но автоматически создали встречу — сохраняем.
        sessionUpdate.meetingUrl = autoMeeting.joinUrl;
      }
      // zoomMeetingId сохраняем только когда встречу реально создали через Zoom.
      if (autoMeeting) {
        sessionUpdate.zoomMeetingId = autoMeeting.meetingId;
      }

      const created = await prisma.session.upsert({
        where: { streamId_lessonId: { streamId, lessonId: id } },
        create: {
          streamId,
          lessonId: id,
          status: isLessonStatus(body.status) ? body.status : 'draft',
          date: body.date !== undefined ? parseLessonDate(body.date) : null,
          startTime: body.startTime?.trim() || null,
          meetingUrl: body.meetingUrl?.trim() || autoMeeting?.joinUrl || null,
          ...(autoMeeting ? { zoomMeetingId: autoMeeting.meetingId } : {}),
          ...(body.summary !== undefined
            ? { summary: body.summary?.trim() || null, summarySource: 'manual' }
            : {}),
        },
        update: sessionUpdate,
        select: sessionSelect,
      });
      session = created as SessionProjection;

      // Перенос занятия (issue #169): если фактически сместился момент старта —
      // date ИЛИ startTime — сбрасываем метки «напоминание отправлено», чтобы
      // напоминания за 60/15 мин переназначились на новое время. Сравниваем СТАРОЕ
      // (existingSession) с НОВЫМ (nextDate/nextStartTime), а не делаем на каждый PATCH.
      // date — @db.Date (Date|null), сравниваем по нормализованному YYYY-MM-DD.
      const prevDateStr = existingSession?.date
        ? existingSession.date.toISOString().slice(0, 10)
        : null;
      const nextDateStr = nextDate ? nextDate.toISOString().slice(0, 10) : null;
      const momentChanged =
        prevDateStr !== nextDateStr ||
        (existingSession?.startTime ?? null) !== nextStartTime;
      // Возврат статуса в planned тоже чистим (дёшево): свежие напоминания на занятие,
      // которое снова станет «запланированным», должны переотправиться.
      const reopenedToPlanned =
        body.status === 'planned' && (existingSession?.status ?? 'draft') !== 'planned';
      if (momentChanged || reopenedToPlanned) {
        // sessionSelect не несёт id — берём id отдельным узким запросом по unique-ключу.
        const sessRow = await prisma.session.findUnique({
          where: { streamId_lessonId: { streamId, lessonId: id } },
          select: { id: true },
        });
        if (sessRow) {
          await prisma.eventReminderSent.deleteMany({
            where: { eventType: 'session', eventId: sessRow.id },
          });
        }
      }

      // Уведомляем учеников, когда урок становится видимым (черновик → не черновик).
      const wasDraft = (existingSession?.status ?? 'draft') === 'draft';
      if (body.status !== undefined && wasDraft && session && session.status !== 'draft') {
        notifyEnrolledLessonVisible(block.id, streamId, block.title).catch(() => {});
      }

      // Отмена занятия: переход в 'cancelled' из НЕ-cancelled. Делаем один раз
      // (по факту смены статуса), чтобы не дублировать уведомления при прочих
      // правках уже отменённого занятия.
      const prevStatus = existingSession?.status ?? 'draft';
      const becameCancelled =
        body.status === 'cancelled' && prevStatus !== 'cancelled';
      if (becameCancelled) {
        // zoomMeetingId нет в проекционной форме (sessionSelect) — дозапрашиваем
        // отдельно, чтобы не менять shim. Если встреча есть — удаляем её в Zoom
        // (best-effort: ошибка Zoom НЕ валит PATCH, только логируется), затем
        // уведомляем зачисленных студентов об отмене тем же каналом, что и
        // уведомление о публикации (notifyMany / lesson_published).
        const sess = await prisma.session.findUnique({
          where: { streamId_lessonId: { streamId, lessonId: id } },
          select: { zoomMeetingId: true },
        });
        if (sess?.zoomMeetingId) {
          try {
            await deleteZoomMeeting(request.user!.userId, sess.zoomMeetingId);
          } catch (err) {
            app.log.warn(
              { err, lessonId: id, streamId, meetingId: sess.zoomMeetingId },
              'Не удалось удалить встречу Zoom при отмене занятия — продолжаем',
            );
          }
        }
        notifyEnrolledLessonCancelled(block.id, streamId, block.title).catch(() => {});
      }
    }

    const projected = projectLesson(block, streamId ?? null, session);
    const full = await finalizeLesson(projected, block);
    return { lesson: full };
  });

  // POST /lessons/:id/materials — загрузка файла-материала урока (admin).
  // Работает с БЛОКОМ урока (lesson.materials) — поведение без изменений.
  // Принимаются строго PDF и Markdown (.md/.markdown).
  app.post('/lessons/:id/materials', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    // Видимость материала. multipart-загрузка файла → доп. поле streamId читаем из
    // QUERY (?streamId=...). Не задан/пуст → общий материал-метод (streamId=null,
    // виден всем потокам, как раньше). Задан → валидируем против сессий урока.
    const visibilityStreamId = normalizeVisibilityStreamId(
      (request.query as { streamId?: string }).streamId,
    );
    if (typeof visibilityStreamId === 'string') {
      try {
        await assertStreamRunsLesson(id, visibilityStreamId);
      } catch (err) {
        if (err instanceof StreamNotForLessonError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    }
    // Нормализуем к null для записи в дескриптор (undefined/'' → общий).
    const materialStreamId: string | null =
      typeof visibilityStreamId === 'string' ? visibilityStreamId : null;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const originalName = data.filename || 'file';
    const mimeType = data.mimetype || 'application/octet-stream';

    if (!isPdfOrMarkdown(originalName, mimeType)) {
      // Слив потока, чтобы не подвиснуть на необработанном файле.
      data.file.resume();
      return reply.status(400).send({ error: 'Поддерживаются только PDF и MD' });
    }

    const chunks: Buffer[] = [];
    await pipeline(
      data.file,
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
    );

    const buffer = Buffer.concat(chunks);

    let uploaded: { key: string; url: string; size: number };
    try {
      uploaded = await uploadFile(buffer, originalName, mimeType, 'lessons');
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
    }

    // Защита/диагностика: запись «прошла», но сразу проверяем, что объект
    // реально читается из хранилища. Если нет (права на чтение префикса lessons/
    // или недурабельная запись) — отдаём явную ошибку с реальной причиной S3,
    // а не «успех», который потом превращается в 404 при «Просмотре».
    const verify = await verifyStoredObject(uploaded.key);
    if (!verify.ok) {
      return reply.status(502).send({
        error: `Файл загружен, но не читается из хранилища (${verify.detail}). Запись прошла, чтение — нет: вероятно, у S3 нет прав на чтение папки lessons/. Сообщите администратору.`,
      });
    }

    const material: LessonMaterial = {
      s3Key: uploaded.key,
      fileName: originalName,
      mimeType,
      size: uploaded.size,
      // null = общий материал-метод; задан = виден только студентам этого потока.
      streamId: materialStreamId,
    };

    // Перезалив файла с тем же именем ЗАМЕНЯЕТ прежний материал, а не плодит дубль
    // (иначе в уроке копятся «старый битый + новый» с одинаковым именем). Старые
    // объекты с тем же именем подчищаем в хранилище best-effort.
    //
    // Матч по ПАРЕ (fileName, streamId): общий и пер-потоковый материал с одинаковым
    // именем — РАЗНЫЕ материалы и НЕ затирают друг друга. Старые данные без поля
    // streamId трактуем как общие (streamId=null), поэтому сравниваем нормализованно.
    const current = sanitizeLessonMaterials(lesson.materials);
    const sameSlot = (m: LessonMaterial) =>
      m.fileName === originalName && (m.streamId ?? null) === materialStreamId;
    const replaced = current.filter(sameSlot);
    for (const old of replaced) {
      if (old.s3Key && old.s3Key !== uploaded.key) {
        deleteFile(old.s3Key).catch(() => {});
      }
    }
    const nextMaterials = [...current.filter((m) => !sameSlot(m)), material];

    await prisma.lesson.update({
      where: { id },
      data: { materials: JSON.parse(JSON.stringify(nextMaterials)) },
    });

    const materials = await regenerateLessonMaterialUrls(nextMaterials);

    return reply.status(201).send({ materials });
  });

  // DELETE /lessons/:id/materials?s3Key=... — удаление материала урока (admin).
  // s3Key передаём в QUERY, а НЕ в пути: ключ материала содержит '/'
  // (напр. lesson-materials/<ts>-<uuid>.md), а закодированный слэш (%2F) в
  // path-параметре ломает маршрутизацию/прокси (404) → материал «не удалялся».
  app.delete('/lessons/:id/materials', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { s3Key } = request.query as { s3Key?: string };
    if (!s3Key) {
      return reply.status(400).send({ error: 'Не указан ключ материала (s3Key)' });
    }
    // Значения query Fastify уже декодирует — используем как есть.
    const key = s3Key;

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const current = sanitizeLessonMaterials(lesson.materials);
    const nextMaterials = current.filter((m) => m.s3Key !== key);

    await prisma.lesson.update({
      where: { id },
      data: { materials: JSON.parse(JSON.stringify(nextMaterials)) },
    });

    const materials = await regenerateLessonMaterialUrls(nextMaterials);

    return { materials };
  });

  // POST /lessons/:id/video — загрузка видеозаписи урока (admin).
  // Работает с БЛОКОМ урока (lesson.videoKey) — поведение без изменений.
  // Принимается ОДИН видеофайл (mp4/webm/mov/m4v, mime video/*).
  //
  // ИЗОЛЯЦИЯ ПО ПОТОКАМ: легаси одиночное видео блока (Lesson.videoKey) НЕ несёт
  // streamId — это всегда ОБЩЕЕ видео-метод (видно всем потокам). Пер-потоковое
  // видео заводится через POST /lessons/:id/videos (LessonVideo.streamId).
  //
  // Видео грузится ПОТОКОМ в S3 через uploadLargeFile с per-route лимитом
  // VIDEO_MAX_FILE_SIZE (5 ГБ) — общий multipart-лимит MAX_FILE_SIZE (50МБ) из
  // server.ts тут НЕ применяется. Обрезанный лимитом файл (truncated) отклоняем
  // c 413, а не сохраняем недолитым.
  app.post('/lessons/:id/video', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file({ limits: { fileSize: VIDEO_MAX_FILE_SIZE } });
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const originalName = data.filename || 'video';
    const mimeType = data.mimetype || 'application/octet-stream';

    if (!isVideoFile(originalName, mimeType)) {
      // Слив потока, чтобы не подвиснуть на необработанном файле.
      data.file.resume();
      return reply.status(400).send({
        error:
          'Поддерживаются только MP4 (H.264) и WebM. Формат .mov/HEVC браузеры не проигрывают — перекодируйте видео в MP4.',
      });
    }

    let uploaded: { key: string; url: string };
    try {
      uploaded = await uploadLargeFile(data.file, originalName, mimeType, 'lesson-videos');
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
    }

    // Защита от тихой обрезки: busboy усекает поток на лимите fileSize и выставляет
    // truncated. Не сохраняем недолитое видео — удаляем загруженный объект и 413.
    if (data.file.truncated) {
      await deleteFile(uploaded.key).catch(() => {});
      return reply.status(413).send({ error: 'Видео превышает максимальный размер 5 ГБ' });
    }

    const updated = (await prisma.lesson.update({
      where: { id },
      data: { videoKey: uploaded.key },
      include: teacherInclude,
    })) as unknown as LessonBlock;

    // Видео — поле блока; возвращаем урок без контекста потока (как и старый ответ,
    // где урок нёс собственное видео). videoFileUrl берётся из блочного videoKey.
    const projected = projectLesson(updated, null, null);
    const full = await finalizeLesson(projected, updated);
    return reply.status(201).send({ lesson: full });
  });

  // DELETE /lessons/:id/video — удаление загруженного видео урока (admin).
  // Работает с БЛОКОМ урока (обнуляем videoKey) — поведение без изменений.
  app.delete('/lessons/:id/video', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const updated = (await prisma.lesson.update({
      where: { id },
      data: { videoKey: null },
      include: teacherInclude,
    })) as unknown as LessonBlock;

    const projected = projectLesson(updated, null, null);
    const full = await finalizeLesson(projected, updated);
    return { lesson: full };
  });

  // ─── Несколько видео на урок (LessonVideo) — АДДИТИВНО ────────────────────
  // Каждое видео — ЛИБО загруженный файл (videoKey в S3) ЛИБО внешняя ссылка
  // (videoUrl). Эндпоинты ниже работают с коллекцией lesson.videos и НЕ трогают
  // унаследованные одиночные Lesson.videoKey/videoUrl (их читают легаси-экраны).

  // POST /lessons/:id/videos — добавить видео урока (admin).
  // multipart → загружаем файл в S3 (videoKey); JSON { url, title? } → внешняя ссылка.
  // title для multipart — опционально из query (?title=...).
  app.post('/lessons/:id/videos', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    // Следующий порядковый номер: max(sortOrder) текущих видео + 1 (нет видео → 0).
    const last = await prisma.lessonVideo.findFirst({
      where: { lessonId: id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = last ? last.sortOrder + 1 : 0;

    // ── Видео-ФАЙЛ (multipart) ──────────────────────────────────────────────
    if (request.isMultipart()) {
      const data = await request.file({ limits: { fileSize: VIDEO_MAX_FILE_SIZE } });
      if (!data) {
        return reply.status(400).send({ error: 'Файл не найден в запросе' });
      }

      const originalName = data.filename || 'video';
      const mimeType = data.mimetype || 'application/octet-stream';

      if (!isVideoFile(originalName, mimeType)) {
        // Слив потока, чтобы не подвиснуть на необработанном файле.
        data.file.resume();
        return reply.status(400).send({
        error:
          'Поддерживаются только MP4 (H.264) и WebM. Формат .mov/HEVC браузеры не проигрывают — перекодируйте видео в MP4.',
      });
      }

      let uploaded: { key: string; url: string };
      try {
        uploaded = await uploadLargeFile(data.file, originalName, mimeType, 'lesson-videos');
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
      }

      // Защита от тихой обрезки: см. POST /lessons/:id/video.
      if (data.file.truncated) {
        await deleteFile(uploaded.key).catch(() => {});
        return reply.status(413).send({ error: 'Видео превышает максимальный размер 5 ГБ' });
      }

      const rawTitle = (request.query as { title?: string }).title;
      const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;

      // Видимость видео: multipart → streamId из QUERY (?streamId=...). Не задан →
      // общее видео-метод (streamId=null, видно всем). Задан → валидируем против сессий.
      const streamId = normalizeVisibilityStreamId(
        (request.query as { streamId?: string }).streamId,
      );
      if (typeof streamId === 'string') {
        try {
          await assertStreamRunsLesson(id, streamId);
        } catch (err) {
          if (err instanceof StreamNotForLessonError) {
            // Загруженный объект уже в S3 — подчищаем, чтобы не оставить сирот.
            await deleteFile(uploaded.key).catch(() => {});
            return reply.status(400).send({ error: err.message });
          }
          throw err;
        }
      }

      await prisma.lessonVideo.create({
        data: {
          lessonId: id,
          videoKey: uploaded.key,
          title,
          sortOrder,
          // null = общее видео-метод; задан = видно только студентам этого потока.
          streamId: typeof streamId === 'string' ? streamId : null,
        },
      });

      return reply.status(201).send(await lessonVideosResponse(id));
    }

    // ── Видео-ССЫЛКА (JSON) ─────────────────────────────────────────────────
    const body = request.body as { url?: string; title?: string; streamId?: string | null };
    if (!body || typeof body.url !== 'string' || !body.url.trim()) {
      return reply.status(400).send({ error: 'Ссылка на видео обязательна' });
    }

    // Видимость видео-ссылки: streamId из ТЕЛА JSON. Не задан → общее (null).
    const linkStreamId = normalizeVisibilityStreamId(body.streamId);
    if (typeof linkStreamId === 'string') {
      try {
        await assertStreamRunsLesson(id, linkStreamId);
      } catch (err) {
        if (err instanceof StreamNotForLessonError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    }

    await prisma.lessonVideo.create({
      data: {
        lessonId: id,
        videoUrl: body.url.trim(),
        title: body.title?.trim() || null,
        sortOrder,
        streamId: typeof linkStreamId === 'string' ? linkStreamId : null,
      },
    });

    return reply.status(201).send(await lessonVideosResponse(id));
  });

  // PATCH /lessons/:id/videos/:videoId — обновить видео урока (admin).
  // Меняем title и/или url (url — только у видео-ССЫЛКИ; у файла url игнорируем) и/или
  // ВИДИМОСТЬ (streamId: общий ↔ поток, в т.ч. сброс в общий). streamId читаем из
  // ТЕЛА JSON (видео правится JSON-запросом, без перезаливки файла); если запрос
  // multipart — из QUERY. Чтобы отличить «не трогаем» от «сбросить в общий», streamId
  // меняем только когда поле ПЕРЕДАНО (присутствует в теле/query).
  app.patch('/lessons/:id/videos/:videoId', { onRequest: adminOnly }, async (request, reply) => {
    const { id, videoId } = request.params as { id: string; videoId: string };

    const video = await prisma.lessonVideo.findFirst({ where: { id: videoId, lessonId: id } });
    if (!video) {
      return reply.status(404).send({ error: 'Видео не найдено' });
    }

    const body = (request.body ?? {}) as { title?: string | null; url?: string; streamId?: string | null };

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) {
      data.title = body.title?.trim() || null;
    }
    // url меняем только у видео-ссылки (videoKey === null); у видео-файла игнорируем.
    if (body.url !== undefined && video.videoKey == null) {
      const trimmed = typeof body.url === 'string' ? body.url.trim() : '';
      if (!trimmed) {
        return reply.status(400).send({ error: 'Ссылка не может быть пустой' });
      }
      data.videoUrl = trimmed;
    }

    // Видимость: меняем, только если streamId ПЕРЕДАН (в теле JSON или query). Пустая
    // строка/отсутствующее значение в переданном поле → сброс в общий (null). Задан
    // непустой поток → валидируем против сессий урока. Поле не передано → не трогаем.
    const rawStreamId =
      body.streamId !== undefined ? body.streamId : (request.query as { streamId?: string }).streamId;
    const hasStreamIdField =
      body.streamId !== undefined || (request.query as { streamId?: string }).streamId !== undefined;
    if (hasStreamIdField) {
      const nextStreamId = normalizeVisibilityStreamId(rawStreamId);
      if (typeof nextStreamId === 'string') {
        try {
          await assertStreamRunsLesson(id, nextStreamId);
        } catch (err) {
          if (err instanceof StreamNotForLessonError) {
            return reply.status(400).send({ error: err.message });
          }
          throw err;
        }
        data.streamId = nextStreamId;
      } else {
        // undefined (поле = null) или '' → сброс в общий.
        data.streamId = null;
      }
    }

    await prisma.lessonVideo.update({ where: { id: videoId }, data });

    return await lessonVideosResponse(id);
  });

  // DELETE /lessons/:id/videos/:videoId — удалить видео урока (admin).
  // S3-объект НЕ удаляем (как и существующий DELETE /lessons/:id/video).
  app.delete('/lessons/:id/videos/:videoId', { onRequest: adminOnly }, async (request, reply) => {
    const { id, videoId } = request.params as { id: string; videoId: string };

    const video = await prisma.lessonVideo.findFirst({ where: { id: videoId, lessonId: id } });
    if (!video) {
      return reply.status(404).send({ error: 'Видео не найдено' });
    }

    await prisma.lessonVideo.delete({ where: { id: videoId } });

    return await lessonVideosResponse(id);
  });

  // POST /lessons/:id/videos/:videoId/progress — приём прогресса просмотра видео
  // урока студентом (Этап A эпика «Лог активности студента»).
  //   :id = lessonId, :videoId = lessonVideoId. Вызывающий — ЗАЧИСЛЕННЫЙ в streamId
  //   студент; studentId = вызывающий (из токена, не из тела).
  // Контракт зафиксирован (от него зависит фронт): тело { streamId, positionSec,
  //   durationSec, intervals: [[start,end],...], ended? }; ответ { watchedPercent,
  //   watchedSec, lastPositionSec, completed }.
  // Право: достаточно факта зачисления в streamId (роль студента явно не требуем).
  // Считаем «честные» секунды по UNION интервалов на сервере (computeProgress):
  //   перемотка назад/повтор не растят watchedSec, перемотка в конец ≠ 100%.
  app.post('/lessons/:id/videos/:videoId/progress', { onRequest: anyAuth }, async (request, reply) => {
    const { id, videoId } = request.params as { id: string; videoId: string };
    const studentId = request.user?.userId;
    if (!studentId) {
      return reply.status(401).send({ error: 'Не авторизован' });
    }

    const body = request.body as {
      streamId?: unknown;
      positionSec?: unknown;
      durationSec?: unknown;
      intervals?: unknown;
      ended?: unknown;
    };

    // ── Валидация тела (ручная — в стиле остальных роутов файла) ───────────────
    const streamId = typeof body.streamId === 'string' ? body.streamId.trim() : '';
    if (!streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }
    const durationSec = body.durationSec;
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
      return reply.status(400).send({ error: 'durationSec должен быть числом > 0' });
    }
    const positionSecRaw = body.positionSec;
    if (
      typeof positionSecRaw !== 'number' ||
      !Number.isFinite(positionSecRaw) ||
      positionSecRaw < 0
    ) {
      return reply.status(400).send({ error: 'positionSec должен быть числом >= 0' });
    }
    if (body.intervals !== undefined && !Array.isArray(body.intervals)) {
      return reply.status(400).send({ error: 'intervals должен быть массивом пар чисел' });
    }
    // Ограничение числа входящих интервалов — защита от раздувания JSON. Лишние
    // отбрасываем (а не падаем): берём первые MAX_INPUT_INTERVALS.
    const rawIntervals = Array.isArray(body.intervals)
      ? (body.intervals as unknown[]).slice(0, MAX_INPUT_INTERVALS)
      : [];
    // Позицию плеера клампим к [0, durationSec] (плеер может прислать чуть больше).
    const lastPositionSec = Math.round(Math.max(0, Math.min(positionSecRaw, durationSec)));

    // ── Проверки существования/доступа ────────────────────────────────────────
    // Видео должно существовать и принадлежать уроку (:id).
    const video = await prisma.lessonVideo.findFirst({
      where: { id: videoId, lessonId: id },
      select: { id: true, videoKey: true },
    });
    if (!video) {
      return reply.status(404).send({ error: 'Видео не найдено' });
    }
    // Отслеживаем только НАШИ файлы (videoKey != null). Внешнее видео (только
    // videoUrl) не трекается — у плеера ссылки нет «честных» интервалов от нас.
    if (!video.videoKey) {
      return reply.status(400).send({ error: 'Внешнее видео не отслеживается' });
    }

    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    // Зачисление студента в поток — единственное право на запись прогресса.
    const enrollment = await prisma.streamEnrollment.findUnique({
      where: { streamId_userId: { streamId, userId: studentId } },
      select: { id: true },
    });
    if (!enrollment) {
      return reply.status(403).send({ error: 'Вы не зачислены в эту группу' });
    }

    const durationSecInt = Math.round(durationSec);

    // ── Атомарный апсёрт прогресса (читаем + считаем union + пишем в одной TX) ──
    // Конкурентные биения не должны терять union: текущие watchedIntervals читаем
    // и слитые пишем атомарно. При гонке на создании ряда возможна коллизия
    // уникального индекса (studentId, lessonVideoId, streamId) → один ретрай.
    const runUpsert = async () => {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.videoView.findUnique({
          where: {
            studentId_lessonVideoId_streamId: {
              studentId,
              lessonVideoId: videoId,
              streamId,
            },
          },
          select: { id: true, watchedIntervals: true, completedAt: true },
        });

        // UNION сохранённых + новых интервалов; watchedSec/percent/completed.
        const progress = computeProgress(
          existing?.watchedIntervals ?? [],
          rawIntervals,
          durationSecInt,
        );

        // completedAt выставляем при первом достижении порога; не сбрасываем.
        const alreadyCompleted = existing?.completedAt != null;
        const completedAt = alreadyCompleted
          ? existing!.completedAt
          : progress.completed
            ? new Date()
            : null;

        const now = new Date();

        if (existing) {
          await tx.videoView.update({
            where: { id: existing.id },
            data: {
              watchedSec: progress.watchedSec,
              watchedPercent: progress.watchedPercent,
              lastPositionSec,
              durationSec: durationSecInt,
              watchedIntervals: progress.mergedIntervals,
              // totalPlayedSec копит сырое (с повторами) время — задел Ур.2.
              totalPlayedSec: { increment: progress.rawPlayedSec },
              lastWatchedAt: now,
              ...(completedAt && !alreadyCompleted ? { completedAt } : {}),
            },
          });
        } else {
          await tx.videoView.create({
            data: {
              studentId,
              lessonVideoId: videoId,
              streamId,
              watchedSec: progress.watchedSec,
              watchedPercent: progress.watchedPercent,
              lastPositionSec,
              durationSec: durationSecInt,
              watchedIntervals: progress.mergedIntervals,
              totalPlayedSec: progress.rawPlayedSec,
              // Первое создание ряда = первый заход (задел Ур.2).
              sessionsCount: 1,
              lastWatchedAt: now,
              ...(completedAt ? { completedAt } : {}),
            },
          });
        }

        return {
          watchedPercent: progress.watchedPercent,
          watchedSec: progress.watchedSec,
          lastPositionSec,
          completed: completedAt != null,
        };
      });
    };

    try {
      return await runUpsert();
    } catch (err) {
      // Коллизия уникального индекса при гонке создания ряда — один ретрай
      // (теперь ряд уже существует → пойдём по ветке update).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return await runUpsert();
      }
      throw err;
    }
  });

  // POST /lessons/:id/materials/access — приём события обращения студента к
  // материалу урока (эпик «Лог активности студента»).
  //   :id = lessonId. Вызывающий — ЗАЧИСЛЕННЫЙ в streamId студент; studentId =
  //   вызывающий (из токена, не из тела). Журнал append-only: каждое обращение =
  //   отдельная строка (без upsert/дедупа).
  // Контракт тела: { streamId, s3Key, accessType: 'viewed' | 'downloaded' }.
  // Право: достаточно факта зачисления в streamId (роль студента явно не требуем) —
  //   ровно как у POST /lessons/:id/videos/:videoId/progress.
  app.post('/lessons/:id/materials/access', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const studentId = request.user?.userId;
    if (!studentId) {
      return reply.status(401).send({ error: 'Не авторизован' });
    }

    const body = request.body as {
      streamId?: unknown;
      s3Key?: unknown;
      accessType?: unknown;
    };

    // ── Валидация тела (ручная — в стиле video-прогресс роута) ──────────────────
    if (body.accessType !== 'viewed' && body.accessType !== 'downloaded') {
      return reply.status(400).send({ error: "accessType должен быть 'viewed' или 'downloaded'" });
    }
    const accessType = body.accessType;
    const streamId = typeof body.streamId === 'string' ? body.streamId.trim() : '';
    if (!streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }
    const s3Key = typeof body.s3Key === 'string' ? body.s3Key.trim() : '';
    if (!s3Key) {
      return reply.status(400).send({ error: 's3Key обязателен' });
    }

    // ── Проверки существования/принадлежности материала уроку ───────────────────
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, materials: true, assignmentMaterials: true },
    });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    // s3Key должен принадлежать этому уроку: ищем среди materials[].s3Key (имя в
    // .fileName) ИЛИ среди assignmentMaterials[].s3Key (имя в .name). Записи без
    // s3Key (assignmentMaterials type:'url') пропускаем. fileName — снимок имени
    // из найденного дескриптора.
    const lessonMaterials = sanitizeLessonMaterials(lesson.materials);
    const foundMaterial = lessonMaterials.find((m) => m.s3Key === s3Key);

    let fileName: string | null = foundMaterial ? foundMaterial.fileName : null;
    if (fileName === null && Array.isArray(lesson.assignmentMaterials)) {
      for (const raw of lesson.assignmentMaterials as unknown[]) {
        if (!raw || typeof raw !== 'object') continue;
        const m = raw as Record<string, unknown>;
        if (typeof m.s3Key === 'string' && m.s3Key === s3Key) {
          fileName = typeof m.name === 'string' ? m.name : '';
          break;
        }
      }
    }

    if (fileName === null) {
      return reply.status(404).send({ error: 'Материал не найден' });
    }

    // Зачисление студента в поток — единственное право на запись события.
    const enrollment = await prisma.streamEnrollment.findUnique({
      where: { streamId_userId: { streamId, userId: studentId } },
      select: { id: true },
    });
    if (!enrollment) {
      return reply.status(403).send({ error: 'Вы не зачислены в эту группу' });
    }

    // Append-only: просто создаём строку (accessedAt дефолтится).
    await prisma.materialAccess.create({
      data: { studentId, lessonId: id, streamId, s3Key, fileName, accessType },
    });

    return { ok: true };
  });

  // PUT /lessons/:id/videos/order — переупорядочить видео урока (admin).
  // orderedIds — желаемый порядок; sortOrder = индекс. Чужие id игнорируем.
  app.put('/lessons/:id/videos/order', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { orderedIds } = request.body as { orderedIds?: string[] };

    if (!Array.isArray(orderedIds)) {
      return reply.status(400).send({ error: 'orderedIds должен быть массивом' });
    }

    // Только реально принадлежащие уроку видео (защита от чужих id).
    const own = await prisma.lessonVideo.findMany({
      where: { lessonId: id },
      select: { id: true },
    });
    const ownSet = new Set(own.map((v) => v.id));

    await prisma.$transaction(
      orderedIds
        .filter((videoId) => ownSet.has(videoId))
        .map((videoId, index) =>
          prisma.lessonVideo.update({
            where: { id: videoId },
            data: { sortOrder: index },
          }),
        ),
    );

    return await lessonVideosResponse(id);
  });

  // GET /lessons/:id/sessions — занятия урока по всем потокам (admin).
  // Для блока «Расписание» на странице урока: где и когда урок запланирован.
  app.get('/lessons/:id/sessions', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id }, select: { id: true } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const sessions = await prisma.session.findMany({
      where: { lessonId: id },
      include: { stream: { select: { id: true, name: true, status: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      // Подпись URL файла записи асинхронна — маппим через Promise.all (как в проекции).
      sessions: await Promise.all(
        sessions.map(async (s) => ({
          streamId: s.streamId,
          streamName: s.stream.name,
          streamStatus: s.stream.status,
          status: s.status,
          date: s.date ? s.date.toISOString().slice(0, 10) : null,
          startTime: s.startTime,
          meetingUrl: s.meetingUrl,
          // Итоги занятия + автосбор записи Zoom (Волна 2) — для бейджей/редактора
          // итогов в блоке «Расписание». Для старых данных поля = null.
          summary: s.summary,
          summarySource: s.summarySource,
          summaryStatus: s.summaryStatus,
          recordingStatus: s.recordingStatus,
          recordingError: s.recordingError,
          // Моменты ожидания записи/итогов — для отличия «формируется» от «таймаут».
          recordingRequestedAt: s.recordingRequestedAt
            ? s.recordingRequestedAt.toISOString()
            : null,
          summaryRequestedAt: s.summaryRequestedAt ? s.summaryRequestedAt.toISOString() : null,
          // Транскрипт занятия (Ф1.4): статус/ошибка/момент ожидания для бейджей. Тело
          // отдаётся отдельным эндпоинтом GET .../transcript — сырые ключи не отдаём.
          transcriptStatus: s.transcriptStatus,
          transcriptError: s.transcriptError,
          transcriptRequestedAt: s.transcriptRequestedAt
            ? s.transcriptRequestedAt.toISOString()
            : null,
          // Медиа записи занятия (admin-only): внешняя ссылка как есть и подписанный
          // временный URL загруженного файла. Сырой videoKey наружу не отдаём.
          recordingVideoUrl: s.videoUrl ?? null,
          recordingFileUrl: await videoFileUrlFor(s.videoKey),
        })),
      ),
    };
  });

  // GET /lessons/:id/analytics?streamId=... — аналитика сдач по ЗАНЯТИЮ (admin).
  // Для View Mode урока: сколько в потоке зачислено, сколько материализовано
  // назначений (StudentAssignment) и их распределение по статусам. Считаем по
  // конкретной Session (lessonId=:id × streamId).
  app.get('/lessons/:id/analytics', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { streamId } = request.query as { streamId?: string };

    if (!streamId || !streamId.trim()) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }

    // Занятие = Session(streamId × lessonId). Нет Session — нет аналитики.
    const session = await prisma.session.findUnique({
      where: { streamId_lessonId: { streamId, lessonId: id } },
      select: { id: true },
    });
    if (!session) {
      return reply.status(404).send({ error: 'Занятие не найдено' });
    }

    // Знаменатель — состав потока (StreamEnrollment), а не материализованные
    // назначения: назначения могут быть ещё не созданы для всех зачисленных.
    // Демо/служебные аккаунты (User.isDemo) исключаем из знаменателя, иначе
    // notSubmittedCount завысится на демо-учеников (они не портят статистику сдач).
    const enrolledCount = await prisma.streamEnrollment.count({
      where: { streamId, user: { isDemo: false } },
    });

    // Распределение материализованных StudentAssignment этого занятия по статусам.
    const grouped = await prisma.studentAssignment.groupBy({
      by: ['status'],
      where: { sessionId: session.id },
      _count: { _all: true },
    });

    const byStatus = { assigned: 0, submitted: 0, reviewed: 0, needs_revision: 0 };
    for (const g of grouped) {
      // status — enum StudentAssignmentStatus, совпадает с ключами byStatus.
      byStatus[g.status as keyof typeof byStatus] = g._count._all;
    }

    const total =
      byStatus.assigned + byStatus.submitted + byStatus.reviewed + byStatus.needs_revision;
    // «Сдал» = всё, кроме ещё не сданного (assigned): submitted/reviewed/needs_revision.
    const submittedCount = byStatus.submitted + byStatus.reviewed + byStatus.needs_revision;
    // Не сдали — относительно состава потока (а не материализованных назначений).
    const notSubmittedCount = Math.max(0, enrolledCount - submittedCount);
    // Ждут проверки — те, кто сдал и ещё не проверен.
    const pendingReviewCount = byStatus.submitted;

    return {
      sessionId: session.id,
      streamId,
      enrolledCount,
      total,
      byStatus,
      submittedCount,
      notSubmittedCount,
      pendingReviewCount,
    };
  });

  // ── Посещаемость занятия (B5, фаза 2; admin) ───────────────────────────────
  // Контекст как у analytics: занятие = Session(lessonId=:id × streamId).
  // Записи посещаемости двух природ: source='zoom_report' (авто-забор; userId
  // проставлен при сопоставлении по email) и source='manual' (ручная отметка).

  // GET /lessons/:id/attendance?streamId= — сводка + список записей посещаемости.
  app.get('/lessons/:id/attendance', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { streamId } = request.query as { streamId?: string };

    if (!streamId || !streamId.trim()) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }

    const session = await prisma.session.findUnique({
      where: { streamId_lessonId: { streamId, lessonId: id } },
      select: { id: true },
    });
    if (!session) {
      return reply.status(404).send({ error: 'Занятие не найдено' });
    }

    const summary = await buildAttendanceSummary(session.id, streamId);
    return summary;
  });

  // POST /lessons/:id/attendance/resync — забрать посещаемость из Zoom заново.
  // streamId — в теле или query. Возвращает свежую сводку при успехе, либо
  // { ok:false, reason } (понятно для UI; НЕ 500) при недоступности отчёта/scope.
  app.post('/lessons/:id/attendance/resync', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { streamId?: string };
    const body = (request.body ?? {}) as { streamId?: string };
    const streamId = (body.streamId ?? query.streamId ?? '').trim();

    if (!streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }

    const session = await prisma.session.findUnique({
      where: { streamId_lessonId: { streamId, lessonId: id } },
      select: { id: true, streamId: true, zoomMeetingId: true, lessonId: true },
    });
    if (!session) {
      return reply.status(404).send({ error: 'Занятие не найдено' });
    }

    // teacherUserId — под чьим OAuth-токеном дёргать Zoom report. Каскад как у
    // ручного ретрая записи (resolveTeacherForZoom): преподаватель урока с рабочей
    // интеграцией → текущий пользователь (если canCreateMeeting) → он же (lib сама
    // вернёт ok:false при невалидном токене). Передаём override, чтобы lib не
    // определяла повторно.
    const teacherUserId = await resolveTeacherForZoom(
      session.lessonId,
      request.user!.userId,
    );

    const result = await pullSessionAttendanceFromZoom(
      app,
      {
        id: session.id,
        streamId: session.streamId,
        zoomMeetingId: session.zoomMeetingId,
      },
      teacherUserId,
    );

    if (!result.ok) {
      // Мягкий отказ (нет scope / отчёт ещё не готов / нет встречи) — 200 с
      // { ok:false, reason }, чтобы UI показал понятную причину, а не ошибку 500.
      return { ok: false, reason: result.reason };
    }

    const summary = await buildAttendanceSummary(session.id, streamId);
    return { ok: true, ...summary };
  });

  // POST /lessons/:id/attendance/mark — ручная отметка посещаемости студента.
  // Тело: { streamId, userId, status:'present'|'absent' }. Дедуп вручную по
  // (sessionId, userId, source='manual'): findFirst → update/create.
  app.post('/lessons/:id/attendance/mark', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      streamId?: string;
      userId?: string;
      status?: string;
    };
    const streamId = (body.streamId ?? '').trim();
    const userId = (body.userId ?? '').trim();
    const status = body.status;

    if (!streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }
    if (!userId) {
      return reply.status(400).send({ error: 'userId обязателен' });
    }
    if (status !== 'present' && status !== 'absent') {
      return reply.status(400).send({ error: 'status должен быть present или absent' });
    }

    const session = await prisma.session.findUnique({
      where: { streamId_lessonId: { streamId, lessonId: id } },
      select: { id: true },
    });
    if (!session) {
      return reply.status(404).send({ error: 'Занятие не найдено' });
    }

    // Студент должен быть зачислен в поток этого занятия.
    const enrollment = await prisma.streamEnrollment.findUnique({
      where: { streamId_userId: { streamId, userId } },
      select: { id: true },
    });
    if (!enrollment) {
      return reply.status(400).send({ error: 'Студент не зачислен в группу' });
    }

    // Дедуп ручного ряда вручную по (sessionId, userId, source='manual').
    const existing = await prisma.sessionAttendance.findFirst({
      where: { sessionId: session.id, userId, source: 'manual' },
      select: { id: true },
    });

    if (existing) {
      await prisma.sessionAttendance.update({
        where: { id: existing.id },
        data: { status },
      });
    } else {
      await prisma.sessionAttendance.create({
        data: { sessionId: session.id, userId, source: 'manual', status },
      });
    }

    const summary = await buildAttendanceSummary(session.id, streamId);
    return summary;
  });

  // PATCH /lessons/:id/attendance/:attendanceId/match — привязать несопоставленного
  // zoom-гостя к студенту потока либо СБРОСИТЬ привязку. Тело: { streamId, userId }.
  // Пустой/непереданный userId = сброс (userId → null), запись снова станет
  // несопоставленным гостем; переназначение = сбросить → привязать заново.
  app.patch(
    '/lessons/:id/attendance/:attendanceId/match',
    { onRequest: adminOnly },
    async (request, reply) => {
      const { id, attendanceId } = request.params as { id: string; attendanceId: string };
      const body = (request.body ?? {}) as { streamId?: string; userId?: string };
      const streamId = (body.streamId ?? '').trim();
      const userId = (body.userId ?? '').trim();

      if (!streamId) {
        return reply.status(400).send({ error: 'streamId обязателен' });
      }

      const session = await prisma.session.findUnique({
        where: { streamId_lessonId: { streamId, lessonId: id } },
        select: { id: true },
      });
      if (!session) {
        return reply.status(404).send({ error: 'Занятие не найдено' });
      }

      // Запись должна существовать и принадлежать этому занятию.
      const record = await prisma.sessionAttendance.findFirst({
        where: { id: attendanceId, sessionId: session.id },
        select: { id: true, isHost: true },
      });
      if (!record) {
        return reply.status(404).send({ error: 'Запись посещаемости не найдена' });
      }

      // Ряд хоста встречи (преподаватель) нельзя привязывать к студенту.
      if (record.isHost === true) {
        return reply
          .status(400)
          .send({ error: 'Нельзя привязать преподавателя (хост встречи)' });
      }

      // Пустой userId — сброс привязки (отвязка), без проверки зачисления.
      if (!userId) {
        await prisma.sessionAttendance.update({
          where: { id: record.id },
          data: { userId: null },
        });
        const summary = await buildAttendanceSummary(session.id, streamId);
        return summary;
      }

      // Студент должен быть зачислен в поток.
      const enrollment = await prisma.streamEnrollment.findUnique({
        where: { streamId_userId: { streamId, userId } },
        select: { id: true },
      });
      if (!enrollment) {
        return reply.status(400).send({ error: 'Студент не зачислен в группу' });
      }

      await prisma.sessionAttendance.update({
        where: { id: record.id },
        data: { userId },
      });

      const summary = await buildAttendanceSummary(session.id, streamId);
      return summary;
    },
  );

  // DELETE /lessons/:id/sessions/:streamId — снять урок с расписания потока (admin).
  // Удаляет Session (и каскадно её StudentAssignment). Сам блок-урок и его место в
  // программе при этом не трогаются.
  app.delete(
    '/lessons/:id/sessions/:streamId',
    { onRequest: adminOnly },
    async (request) => {
      const { id, streamId } = request.params as { id: string; streamId: string };
      await prisma.session.deleteMany({ where: { lessonId: id, streamId } });
      return { message: 'Снято с расписания' };
    },
  );

  // POST /lessons/:id/sessions/:streamId/recording/retry — повторно запустить
  // автозагрузку записи Zoom для занятия. Право: админ ИЛИ преподаватель урока
  // (раньше было только admin — теперь и препод может добрать свою запись). Нужно,
  // когда автоскачивание по вебхуку recording.completed упало (recordingStatus=
  // 'failed') или зависло. Идемпотентность встроена в processRecordingForSession:
  // если запись уже выгружена (videoKey есть) — пометит 'ready'; если обработка
  // уже идёт ('processing'/'ready') — claim не пройдёт и повтор не скачает второй
  // раз; из 'failed'/'pending'/null claim пускает повтор.
  app.post(
    '/lessons/:id/sessions/:streamId/recording/retry',
    { onRequest: lessonTeacherOrAdmin },
    async (request, reply) => {
      const { id, streamId } = request.params as { id: string; streamId: string };

      const session = await prisma.session.findFirst({
        where: { lessonId: id, streamId },
        select: { id: true, zoomMeetingId: true, recordingStatus: true, lessonId: true },
      });
      if (!session) {
        return reply.status(404).send({ error: 'Занятие не найдено' });
      }

      // Без привязки к встрече Zoom скачивать нечего (нет meetingId для API/вебхука).
      if (!session.zoomMeetingId) {
        return reply.status(400).send({ error: 'Нет привязки к встрече Zoom' });
      }

      // teacherUserId — под чьим OAuth-токеном Zoom скачивается запись. Каскад
      // фолбэков (resolveTeacherForZoom): преподаватель урока с рабочей интеграцией
      // → текущий пользователь (если canCreateMeeting) → он же без проверки
      // (processRecordingForSession безопасно зафиксирует ошибку токена). Реальный
      // владелец встречи в БД не хранится — отсюда каскад.
      const teacherUserId = await resolveTeacherForZoom(
        session.lessonId,
        request.user!.userId,
      );

      // Запускаем повтор fire-and-forget: тяжёлое скачивание/заливку не держим в
      // запросе (как и в вебхуке). downloadToken НЕ передаём — при ручном ретрае его
      // нет, processRecordingForSession сам возьмёт OAuth-токен (через ?access_token).
      void processRecordingForSession({
        sessionId: session.id,
        meetingId: session.zoomMeetingId,
        teacherUserId,
      }).catch((err) => {
        app.log.error(
          { err, sessionId: session.id },
          'Ошибка ручного ретрая записи Zoom',
        );
      });

      // 202 Accepted: обработка запущена в фоне. Возвращаем текущий статус —
      // claim в processRecordingForSession уже мог перевести 'failed'→'processing'.
      return reply.status(202).send({
        status: session.recordingStatus ?? 'processing',
        message: 'Повторная загрузка записи запущена',
      });
    },
  );

  // POST /lessons/:id/sessions/:streamId/refresh — ЕДИНАЯ ручная подтяжка из Zoom
  // («Обновить из Zoom»): запись + итоги + транскрипт + посещаемость. Право: админ
  // ИЛИ преподаватель урока. Каждый шаг — best-effort: ошибка одного НЕ валит
  // остальные. Возвращает ЧАСТИЧНЫЙ результат, чтобы фронт показал тост «что
  // получилось»: { recording:{ok,reason?}, summary:{...}, transcript:{...}, attendance:{...} }.
  //
  // В отличие от recording/retry (fire-and-forget 202), refresh ДОЖИДАЕТСЯ шагов —
  // пользователь жмёт кнопку и ждёт результат. Запись/итоги/транскрипт могут идти
  // секунды-минуты (скачивание), поэтому это синхронный, но best-effort вызов.
  app.post(
    '/lessons/:id/sessions/:streamId/refresh',
    { onRequest: lessonTeacherOrAdmin },
    async (request, reply) => {
      const { id, streamId } = request.params as { id: string; streamId: string };

      const session = await prisma.session.findFirst({
        where: { lessonId: id, streamId },
        select: {
          id: true,
          streamId: true,
          zoomMeetingId: true,
          zoomMeetingUuid: true,
          lessonId: true,
        },
      });
      if (!session) {
        return reply.status(404).send({ error: 'Занятие не найдено' });
      }

      if (!session.zoomMeetingId) {
        return reply.status(400).send({ error: 'Нет привязки к встрече Zoom' });
      }
      const meetingId = session.zoomMeetingId;

      const teacherUserId = await resolveTeacherForZoom(
        session.lessonId,
        request.user!.userId,
      );

      // Шаг best-effort: запускает работу, ловит ошибку и приводит к { ok, reason? }.
      // Различаем ТРИ исхода (см. ProcessOutcome в zoom-recording):
      //   - 'ready'      → { ok:true } (данные получены);
      //   - 'processing' → { ok:false, reason:'ещё формируется' } — данных у Zoom ЕЩЁ
      //                    НЕТ/не готовы; это НЕ ошибка, фронт-тост скажет «формируется»;
      //   - throw        → { ok:false, reason:<...> } — РЕАЛЬНАЯ ошибка.
      // При exposeError=true (summary/transcript) reason несёт ФАКТИЧЕСКИЙ текст ошибки
      // Zoom (с кодом статуса, напр. «Zoom вернул ошибку … (403)») — это admin/teacher
      // эндпоинт, текст безопасен (без сырых URL/токенов, см. getMeetingSummary). Иначе
      // reason — общий failReason. «ещё формируется» (processing) НЕ ошибка — без кода.
      const step = async (
        fn: () => Promise<ProcessOutcome>,
        failReason: string,
        exposeError = false,
      ) => {
        try {
          const outcome = await fn();
          if (outcome === 'processing') {
            return { ok: false as const, reason: 'ещё формируется' };
          }
          return { ok: true as const };
        } catch (err) {
          app.log.error({ err, sessionId: session.id }, `refresh: ${failReason}`);
          const detail = err instanceof Error ? err.message.trim() : '';
          const reason = exposeError && detail ? detail : failReason;
          return { ok: false as const, reason };
        }
      };

      // Запускаем параллельно — шаги независимы (разные поля Session/таблицы).
      const [recording, summary, transcript, attendanceRes] = await Promise.all([
        step(
          () =>
            processRecordingForSession({
              sessionId: session.id,
              meetingId,
              teacherUserId,
            }),
          'не удалось обновить запись',
        ),
        step(
          () =>
            processSummaryForSession({
              sessionId: session.id,
              meetingId,
              teacherUserId,
              meetingUuid: session.zoomMeetingUuid,
            }),
          'не удалось обновить итоги',
          true,
        ),
        step(
          () =>
            processTranscriptForSession({
              sessionId: session.id,
              meetingId,
              teacherUserId,
            }),
          'не удалось обновить транскрипт',
          true,
        ),
        // Посещаемость возвращает { ok, reason } САМА (не бросает) — оборачиваем
        // дополнительно на случай неожиданного исключения.
        (async () => {
          try {
            const res = await pullSessionAttendanceFromZoom(
              app,
              {
                id: session.id,
                streamId: session.streamId,
                zoomMeetingId: session.zoomMeetingId,
              },
              teacherUserId,
            );
            return res.ok
              ? { ok: true as const }
              : { ok: false as const, reason: res.reason };
          } catch (err) {
            app.log.error(
              { err, sessionId: session.id },
              'refresh: не удалось обновить посещаемость',
            );
            return { ok: false as const, reason: 'не удалось обновить посещаемость' };
          }
        })(),
      ]);

      return { recording, summary, transcript, attendance: attendanceRes };
    },
  );

  // GET /lessons/:id/sessions/:streamId/transcript?format=vtt|txt — отдать тело
  // транскрипта занятия. Право: админ ИЛИ преподаватель урока (студенту — 403,
  // обеспечивается гардом lessonTeacherOrAdmin). Возвращает подписанный временный
  // S3-URL на нужный формат (как у записи) — клиент скачивает напрямую через /files.
  // По умолчанию format=txt (очищенный текст). format=vtt — сырой WebVTT.
  app.get(
    '/lessons/:id/sessions/:streamId/transcript',
    { onRequest: lessonTeacherOrAdmin },
    async (request, reply) => {
      const { id, streamId } = request.params as { id: string; streamId: string };
      const { format, inline } = request.query as { format?: string; inline?: string };
      const fmt = format === 'vtt' ? 'vtt' : 'txt';
      const wantInline = inline === 'true' || inline === '1';

      const session = await prisma.session.findFirst({
        where: { lessonId: id, streamId },
        select: {
          id: true,
          transcriptStatus: true,
          transcriptVttKey: true,
          transcriptTxtKey: true,
        },
      });
      if (!session) {
        return reply.status(404).send({ error: 'Занятие не найдено' });
      }

      const key = fmt === 'vtt' ? session.transcriptVttKey : session.transcriptTxtKey;
      if (!key) {
        return reply
          .status(404)
          .send({ error: 'Транскрипт недоступен', status: session.transcriptStatus ?? null });
      }

      // inline=true — отдаём ТЕКСТ транскрипта прямо в JSON: интеграции по sk_-ключу
      // получают содержимое за один запрос, без зависимости от достижимости /files.
      if (wantInline) {
        const text = await readFileText(key);
        if (text === null) {
          return reply
            .status(404)
            .send({ error: 'Транскрипт недоступен в хранилище', status: session.transcriptStatus ?? null });
        }
        return { format: fmt, status: session.transcriptStatus ?? null, text };
      }

      const url = await getFileUrl(key);
      return { format: fmt, url, status: session.transcriptStatus ?? null };
    },
  );

  // DELETE /lessons/:id — удаление урока (admin).
  // Удаляем блок Lesson: каскадно уходят ProgramLesson, Session и StudentAssignment.
  app.delete('/lessons/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.lesson.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    await prisma.lesson.delete({ where: { id } });

    return { message: 'Урок удалён' };
  });
}

// Уведомление ученикам потока о том, что урок стал виден (Session стала недрафтовой).
async function notifyEnrolledLessonVisible(
  lessonId: string,
  streamId: string,
  title: string,
): Promise<void> {
  const enrollments = await prisma.streamEnrollment.findMany({
    where: { streamId },
    select: { userId: true },
  });
  await notifyMany(
    enrollments.map((e) => e.userId),
    'lesson_published',
    'Новый урок',
    `Урок «${title}» доступен`,
    { lessonId },
  );
}

// Уведомление ученикам потока об отмене занятия. Используем тот же канал
// (notifyMany / тип lesson_published), что и уведомление о публикации — отдельного
// enum-типа под отмену в схеме нет, заводить его потребовало бы миграции.
async function notifyEnrolledLessonCancelled(
  lessonId: string,
  streamId: string,
  title: string,
): Promise<void> {
  const enrollments = await prisma.streamEnrollment.findMany({
    where: { streamId },
    select: { userId: true },
  });
  await notifyMany(
    enrollments.map((e) => e.userId),
    'lesson_published',
    'Занятие отменено',
    `Занятие «${title}» отменено`,
    { lessonId },
  );
}

// Строит сводку посещаемости занятия для фронта: счётчики + список записей с
// именем сопоставленного студента (join к User). present/absent считаем по полю
// status; matched — есть ли сопоставленный userId.
//
// ВАЖНО про двойной учёт: у одного студента может быть И zoom-ряд (сопоставленный),
// И ручной ряд (manual имеет приоритет). Чтобы счётчики present/absent отражали
// фактическое присутствие без задвоения, считаем их по УНИКАЛЬНЫМ сопоставленным
// студентам (по userId; manual имеет приоритет над zoom_report). Несопоставленные
// гости (userId=null) в present/absent не входят, но видны в unmatchedCount и в
// records (их можно привязать через /match).
async function buildAttendanceSummary(sessionId: string, streamId: string) {
  const [enrolledCount, records] = await Promise.all([
    // «Всего в группе» — без демо/служебных аккаунтов (User.isDemo), чтобы знаменатель
    // совпадал со статистикой и present+absent не превышали enrolled (демо-присутствие
    // также исключаем из present/absent ниже).
    prisma.streamEnrollment.count({ where: { streamId, user: { isDemo: false } } }),
    prisma.sessionAttendance.findMany({
      where: { sessionId },
      select: {
        id: true,
        userId: true,
        source: true,
        status: true,
        isHost: true,
        displayName: true,
        email: true,
        joinedAt: true,
        leftAt: true,
        durationSec: true,
        updatedAt: true,
        // isDemo — чтобы исключить демо-учеников из present/absent (они не учитываются
        // в статистике). В сам список records они при этом попадают (админ их видит).
        user: { select: { name: true, isDemo: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Статус на студента: manual приоритетнее zoom_report.
  const statusByUser = new Map<string, { status: string; manual: boolean }>();
  let unmatchedCount = 0;
  let lastSyncedAt: Date | null = null;

  for (const r of records) {
    if (r.source === 'zoom_report') {
      if (!lastSyncedAt || r.updatedAt > lastSyncedAt) lastSyncedAt = r.updatedAt;
    }
    // Ряд хоста встречи (преподаватель) не студент-гость: не считаем его в гостях
    // и не учитываем в статусах студентов. На фронте он показывается отдельно.
    if (r.isHost) {
      continue;
    }
    if (!r.userId) {
      unmatchedCount += 1;
      continue;
    }
    // Демо/служебные ученики не учитываются в статистике present/absent (как и в
    // enrolledCount). Сам ряд при этом остаётся в records — админ видит его.
    if (r.user?.isDemo) {
      continue;
    }
    const isManual = r.source === 'manual';
    const prev = statusByUser.get(r.userId);
    // Записываем, если ещё нет, либо текущий manual перебивает прежний zoom-ряд.
    if (!prev || (isManual && !prev.manual)) {
      statusByUser.set(r.userId, { status: r.status, manual: isManual });
    }
  }

  let presentCount = 0;
  let absentCount = 0;
  for (const v of statusByUser.values()) {
    if (v.status === 'present') presentCount += 1;
    else if (v.status === 'absent') absentCount += 1;
  }

  return {
    sessionId,
    streamId,
    enrolledCount,
    presentCount,
    absentCount,
    unmatchedCount,
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    records: records.map((r) => ({
      id: r.id,
      userId: r.userId,
      studentName: r.user?.name ?? null,
      source: r.source,
      status: r.status,
      displayName: r.displayName,
      email: r.email,
      joinedAt: r.joinedAt ? r.joinedAt.toISOString() : null,
      leftAt: r.leftAt ? r.leftAt.toISOString() : null,
      durationSec: r.durationSec,
      matched: r.userId !== null,
      isHost: r.isHost,
    })),
  };
}
