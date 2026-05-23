import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { notifyMany } from '../lib/notifications.js';
import { isEnrolled } from '../lib/enrollment.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { createZoomMeeting, shouldAutoCreate, canCreateMeeting } from '../lib/zoom.js';
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

// Спроецированное видео урока для ответов фронту: kind различает файл/ссылку,
// url — подписанный временный URL файла или внешняя ссылка как есть.
type ProjectedVideo = { id: string; title: string | null; kind: 'file' | 'link'; url: string; sortOrder: number };

// Проецирует список видео урока: для файлов подписываем временный URL по videoKey,
// для ссылок берём videoUrl напрямую. Видео без url/key и файлы без валидной подписи
// отбрасываем (как одиночное видео в videoFileUrlFor).
async function projectVideos(videos: LessonBlock['videos']): Promise<ProjectedVideo[]> {
  if (!videos?.length) return [];
  const out = await Promise.all(
    videos.map(async (v) => {
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

// Ре-подписывает временные url по s3Key для всех материалов урока.
async function regenerateLessonMaterialUrls(
  materials: LessonMaterial[],
): Promise<LessonMaterial[]> {
  return Promise.all(
    materials.map(async (m) => {
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
function sanitizeLessonMaterials(input: unknown): LessonMaterial[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter((m) => typeof m.s3Key === 'string' && typeof m.fileName === 'string')
    .map((m) => ({
      s3Key: m.s3Key as string,
      fileName: m.fileName as string,
      mimeType: typeof m.mimeType === 'string' ? m.mimeType : 'application/octet-stream',
      size: typeof m.size === 'number' ? m.size : 0,
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

// Допускаем видеофайлы по расширению И mime. Проверяем оба, т.к. браузеры/ОС
// иногда отдают пустой/неточный mime для .mov/.m4v.
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v'];

function isVideoFile(fileName: string, mimeType: string): boolean {
  const lowerName = (fileName || '').toLowerCase();
  const okExt = VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const okMime = (mimeType || '').toLowerCase().startsWith('video/');
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
  videos?: { id: string; title: string | null; videoKey: string | null; videoUrl: string | null; sortOrder: number }[];
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
  recordingStatus: string | null;
  recordingError: string | null;
} | null;

// Преобразует пару (блок урока, его Session в контексте потока) к ПЛОСКОЙ форме
// урока для фронта (как было в старой модели):
//   - все поля блока (id/title/videoUrl/videoKey/summary/notes/materials/sortOrder
//     + folded assignment*),
//   - teachers → [{id,name}],
//   - streamId — контекст потока (или null вне потока),
//   - status/date/startTime/meetingUrl — из Session (если Session нет: draft / null),
//   - видео: предпочитаем Session.videoKey/videoUrl блочным.
// materials/videoFileUrl ре-подписываются вызывающим (они асинхронные).
// Экспортируется для unit-тестов проекции (в частности admin-only recordingError).
export function projectLesson(
  block: LessonBlock,
  streamId: string | null,
  session: SessionProjection,
  // recordingError — деталь для админа (текст ошибки автозагрузки). Студентам не
  // отдаём (раскрывает внутренности обработки), поэтому для не-админа зануляем.
  // По умолчанию true: admin-only роуты (POST/PATCH) не меняют поведение.
  isAdmin = true,
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
  // Автосбор записи/итогов Zoom (Волна 2). Аддитивно: для уроков без Session
  // или со старыми данными — null, поведение не меняется.
  recordingStatus: string | null;
  recordingError: string | null;
  summarySource: string | null;
} {
  // Видео: Session перекрывает блок (запись конкретного занятия важнее блочной).
  const videoKey = session?.videoKey ?? block.videoKey;
  const videoUrl = session?.videoUrl ?? block.videoUrl;
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
    // Статус автозагрузки записи Zoom и источник итогов (для UI). Вне потока
    // (Session нет) — null, как и для занятий без созвона Zoom.
    recordingStatus: session?.recordingStatus ?? null,
    // recordingError — только админам (текст ошибки чувствителен); студенту — null.
    recordingError: isAdmin ? session?.recordingError ?? null : null,
    summarySource: session?.summarySource ?? null,
  };
}

// Достраивает спроецированный урок асинхронными полями (videoFileUrl + ре-подписанные
// materials). videoKey уже выбран с приоритетом Session в projectLesson.
async function finalizeLesson(
  projected: ReturnType<typeof projectLesson>,
  block: LessonBlock,
): Promise<Record<string, unknown>> {
  const videoFileUrl = await videoFileUrlFor(projected.videoKey);
  const materials = await regenerateLessonMaterialUrls(
    (block.materials as unknown as LessonMaterial[]) || [],
  );
  // Аддитивно: список из нескольких видео урока (одиночные videoUrl/videoFileUrl сохранены).
  const videos = await projectVideos(block.videos);
  return { ...projected, videoFileUrl, materials, videos };
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
  recordingStatus: true,
  recordingError: true,
} as const;

export async function lessonRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');
  const anyAuth = authenticate;

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
        visible.map((block) => finalizeLesson(projectLesson(block, null, null, isAdmin), block)),
      );
      return { lessons: shaped };
    }

    // ── С streamId ────────────────────────────────────────────────────────────
    const stream = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { id: true, name: true, programId: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    // Студент видит уроки только своих потоков
    if (!isAdmin && !(await isEnrolled(request.user!.userId, streamId))) {
      return reply.status(403).send({ error: 'Нет доступа к этому потоку' });
    }

    const isMine = isAdmin && mine === 'true';

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
        include: { lesson: { include: teacherInclude } },
      });
      orderedBlocks = programLessons.map((pl) => pl.lesson as unknown as LessonBlock);
    } else {
      // Менторский поток: уроки = уроки его Session.
      const sessionLessons = await prisma.session.findMany({
        where: { streamId },
        include: { lesson: { include: teacherInclude } },
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

    const shaped = await Promise.all(
      visibleBlocks.map((block) => {
        const s = sessionByLesson.get(block.id) ?? null;
        const projected = projectLesson(block, streamId, s as SessionProjection, isAdmin);
        return finalizeLesson(projected, block).then((full) => ({
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

      // Если фронт прислал streamId — приоритетно проверяем его, иначе перебираем все.
      const candidateStreamIds = streamId
        ? enrolledStreamIds.filter((sid) => sid === streamId)
        : enrolledStreamIds;

      if (candidateStreamIds.length === 0) {
        return reply.status(404).send({ error: 'Урок не найден' });
      }

      // Session этого урока в потоках студента (несут видимость/расписание).
      const candidateSessions = await prisma.session.findMany({
        where: { lessonId: id, streamId: { in: candidateStreamIds } },
        select: { streamId: true, ...sessionSelect },
      });

      // Студенту виден урок только через недрафтовую Session.
      const visibleSession =
        candidateSessions.find((s) => s.status !== 'draft') ?? null;

      if (!visibleSession) {
        return reply.status(404).send({ error: 'Урок не найден' });
      }

      contextStreamId = visibleSession.streamId;
      session = visibleSession as SessionProjection;
    }

    const projected = projectLesson(block, contextStreamId, session, isAdmin);
    const full = await finalizeLesson(projected, block);

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

    const status: LessonStatusValue = isLessonStatus(body.status) ? body.status : 'draft';
    const date = parseLessonDate(body.date);

    const teacherIds = Array.isArray(body.teacherIds)
      ? await filterAdminIds(body.teacherIds)
      : [];

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

    const stream = await prisma.stream.findUnique({
      where: { id: body.streamId },
      select: { id: true, status: true, programId: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (stream.status === 'archived') {
      return reply.status(400).send({ error: 'Нельзя добавлять уроки в архивный поток' });
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

      // Уведомляем учеников, когда урок становится видимым (черновик → не черновик).
      const wasDraft = (existingSession?.status ?? 'draft') === 'draft';
      if (body.status !== undefined && wasDraft && session && session.status !== 'draft') {
        notifyEnrolledLessonVisible(block.id, streamId, block.title).catch(() => {});
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

    const material: LessonMaterial = {
      s3Key: uploaded.key,
      fileName: originalName,
      mimeType,
      size: uploaded.size,
    };

    const current = sanitizeLessonMaterials(lesson.materials);
    const nextMaterials = [...current, material];

    await prisma.lesson.update({
      where: { id },
      data: { materials: JSON.parse(JSON.stringify(nextMaterials)) },
    });

    const materials = await regenerateLessonMaterialUrls(nextMaterials);

    return reply.status(201).send({ materials });
  });

  // DELETE /lessons/:id/materials/:s3Key — удаление материала урока (admin).
  // Работает с БЛОКОМ урока — поведение без изменений.
  app.delete('/lessons/:id/materials/:s3Key', { onRequest: adminOnly }, async (request, reply) => {
    const { id, s3Key } = request.params as { id: string; s3Key: string };
    const key = decodeURIComponent(s3Key);

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
  // ВНИМАНИЕ: лимит размера НЕ повышаем — действует общий multipart-лимит
  // MAX_FILE_SIZE (50МБ) из server.ts.
  app.post('/lessons/:id/video', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const originalName = data.filename || 'video';
    const mimeType = data.mimetype || 'application/octet-stream';

    if (!isVideoFile(originalName, mimeType)) {
      // Слив потока, чтобы не подвиснуть на необработанном файле.
      data.file.resume();
      return reply.status(400).send({ error: 'Поддерживаются видеофайлы (MP4)' });
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
      uploaded = await uploadFile(buffer, originalName, mimeType, 'lesson-videos');
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
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
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'Файл не найден в запросе' });
      }

      const originalName = data.filename || 'video';
      const mimeType = data.mimetype || 'application/octet-stream';

      if (!isVideoFile(originalName, mimeType)) {
        // Слив потока, чтобы не подвиснуть на необработанном файле.
        data.file.resume();
        return reply.status(400).send({ error: 'Поддерживаются видеофайлы (MP4)' });
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
        uploaded = await uploadFile(buffer, originalName, mimeType, 'lesson-videos');
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
      }

      const rawTitle = (request.query as { title?: string }).title;
      const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;

      await prisma.lessonVideo.create({
        data: { lessonId: id, videoKey: uploaded.key, title, sortOrder },
      });

      return reply.status(201).send(await lessonVideosResponse(id));
    }

    // ── Видео-ССЫЛКА (JSON) ─────────────────────────────────────────────────
    const body = request.body as { url?: string; title?: string };
    if (!body || typeof body.url !== 'string' || !body.url.trim()) {
      return reply.status(400).send({ error: 'Ссылка на видео обязательна' });
    }

    await prisma.lessonVideo.create({
      data: {
        lessonId: id,
        videoUrl: body.url.trim(),
        title: body.title?.trim() || null,
        sortOrder,
      },
    });

    return reply.status(201).send(await lessonVideosResponse(id));
  });

  // PATCH /lessons/:id/videos/:videoId — обновить видео урока (admin).
  // Меняем title и/или url (url — только у видео-ССЫЛКИ; у файла url игнорируем).
  app.patch('/lessons/:id/videos/:videoId', { onRequest: adminOnly }, async (request, reply) => {
    const { id, videoId } = request.params as { id: string; videoId: string };

    const video = await prisma.lessonVideo.findFirst({ where: { id: videoId, lessonId: id } });
    if (!video) {
      return reply.status(404).send({ error: 'Видео не найдено' });
    }

    const body = request.body as { title?: string | null; url?: string };

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
      sessions: sessions.map((s) => ({
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
        recordingStatus: s.recordingStatus,
        recordingError: s.recordingError,
      })),
    };
  });

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
