import { randomUUID } from 'node:crypto';
import { prisma } from '@platform/db';
import {
  canCreateMeeting,
  getMeetingRecordings,
  getMeetingSummary,
  getZoomAccessToken,
  type ZoomRecordingFile,
  type ZoomMeetingSummary,
} from './zoom.js';
import { uploadStream } from './s3.js';

// Фоновая (асинхронная) обработка вебхуков Zoom: выгрузка записи занятия в S3 и
// сбор AI-резюме. Вызывается роутом вебхука fire-and-forget — функции сами
// обновляют статусы Session и НЕ бросают наружу (ошибку фиксируем в recordingError).

// Ошибка с УЖЕ обобщённым (безопасным для показа админу) текстом. Только такие
// сообщения попадают в Session.recordingError. Любая прочая ошибка (системная
// fetch/DNS/S3 — её message может содержать сырой URL/хост/тело ответа) при записи
// в recordingError заменяется на нейтральный текст, чтобы не светить внутренности.
class SafeRecordingError extends Error {}

// Сбой скачивания файла записи по HTTP-коду (401/404/5xx и т.п.). Отдельный
// подтип, чтобы отличить ТРАНЗИЕНТНЫЙ сбой CDN Zoom (файл ещё «доезжает» после
// recording.completed) от нетранзиентных ошибок («нет MP4», «недопустимый хост»)
// и сделать авто-ретрай только для транзиентных. status хранится отдельно от
// текста, текст остаётся безопасным (только код, без URL/тела ответа Zoom).
class RecordingDownloadHttpError extends SafeRecordingError {
  readonly status: number;
  constructor(status: number) {
    super(`Не удалось скачать запись Zoom (HTTP ${status})`);
    this.status = status;
  }
}

// Транзиентный ли HTTP-сбой скачивания: 401 (токен/редирект ещё не «прогрелся»),
// 404 (файл ещё не доехал по CDN Zoom), любой 5xx (временная ошибка хранилища).
// Для таких имеет смысл повторить скачивание с паузой ПЕРЕД пометкой failed.
function isTransientDownloadError(err: unknown): boolean {
  if (!(err instanceof RecordingDownloadHttpError)) return false;
  const s = err.status;
  return s === 401 || s === 404 || s >= 500;
}

// Паузы между авто-ретраями скачивания (мс). Дефолт — реальный backoff (20с, 60с):
// файл записи у Zoom может «доезжать» по CDN секунды-минуты после события. В тестах
// массив переопределяется на нулевые задержки, чтобы прогон не висел.
const DEFAULT_RETRY_DELAYS_MS = [20_000, 60_000];

// Пауза, прерываемая (по умолчанию через setTimeout). Вынесена в параметр, чтобы
// в тестах подменять на мгновенную (нулевую) и не ждать реальные секунды.
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Текст для recordingError: для «безопасных» ошибок — как есть, иначе обобщённо.
function safeRecordingErrorMessage(err: unknown): string {
  if (err instanceof SafeRecordingError) return err.message;
  return 'Не удалось обработать запись Zoom';
}

// Выбирает основной видеофайл записи: предпочитаем «экран + спикер» (MP4),
// затем любой MP4, затем любой файл с download_url. Возвращает null, если
// подходящего файла нет.
export function pickMainRecording(
  files: ZoomRecordingFile[] | undefined | null,
): ZoomRecordingFile | null {
  if (!files || files.length === 0) return null;

  const isMp4 = (f: ZoomRecordingFile) =>
    f.file_type === 'MP4' || (f.file_extension ?? '').toUpperCase() === 'MP4';

  // 1) shared_screen_with_speaker_view + MP4 — самый полезный вид записи.
  const preferred = files.find(
    (f) => f.recording_type === 'shared_screen_with_speaker_view' && isMp4(f) && f.download_url,
  );
  if (preferred) return preferred;

  // 2) Любой MP4 с ссылкой на скачивание.
  const anyMp4 = files.find((f) => isMp4(f) && f.download_url);
  if (anyMp4) return anyMp4;

  // 3) Хоть что-то скачиваемое (запасной вариант).
  const anyDownloadable = files.find((f) => f.download_url);
  return anyDownloadable ?? null;
}

// Анти-SSRF: download_url приходит из тела вебхука (недоверенные данные даже после
// проверки подписи). Качаем с Bearer-токеном Zoom ТОЛЬКО с хостов Zoom, иначе
// злоумышленник с валидной подписью мог бы увести наш OAuth-токен на чужой адрес
// или достучаться до внутренней сети. Разрешаем только https и домены zoom.us/zoom.com.
function isAllowedZoomDownloadUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === 'zoom.us' ||
      host.endsWith('.zoom.us') ||
      host === 'zoom.com' ||
      host.endsWith('.zoom.com')
    );
  } catch {
    return false;
  }
}

// Качает download_url Zoom потоком (с Bearer-токеном) и возвращает тело ответа
// для стримовой загрузки в S3. Бросает при не-2xx или недопустимом хосте.
async function fetchRecordingStream(
  downloadUrl: string,
  token: string,
): Promise<ReadableStream> {
  if (!isAllowedZoomDownloadUrl(downloadUrl)) {
    throw new SafeRecordingError('Недопустимый хост ссылки на запись Zoom');
  }
  // Токен передаём query-параметром access_token, а НЕ заголовком Authorization:
  // на скачивании Zoom отдаёт 302-редирект на хранилище, а fetch по спецификации
  // срезает Authorization при кросс-доменном редиректе → хранилище видит запрос
  // без токена и отвечает 401 (ровно этот баг и наблюдали). С access_token в URL
  // аутентификация проходит на хосте Zoom, а редирект ведёт на уже подписанный
  // URL хранилища. Токен уходит только на проверенный хост Zoom (хост проверен выше).
  const url = new URL(downloadUrl);
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    // Только статус, без URL/тела ответа Zoom. Тип несёт код, чтобы выше
    // отличить транзиентный сбой (401/404/5xx) и повторить скачивание.
    throw new RecordingDownloadHttpError(res.status);
  }
  return res.body as unknown as ReadableStream;
}

// Обрабатывает событие recording.completed: скачивает основной MP4 и заливает в S3.
// `payloadFiles` — recording_files из вебхука (если есть); иначе тянем через API.
// Идемпотентность: если у Session уже стоит videoKey — выходим, не перезаписывая.
export async function processRecordingForSession(params: {
  sessionId: string;
  meetingId: string;
  teacherUserId: string;
  payloadFiles?: ZoomRecordingFile[] | null;
  // download_token из вебхука recording.completed — короткоживущий токен Zoom,
  // выданный специально для скачивания файлов этого события. Предпочитаем его
  // OAuth-токену аккаунта; у ручного ретрая его нет — там фолбэк на OAuth-токен.
  downloadToken?: string | null;
  // Паузы между авто-ретраями транзиентного сбоя скачивания (мс). По умолчанию
  // реальный backoff (20с, 60с). В тестах передаём [] или нули, чтобы не ждать.
  retryDelaysMs?: number[];
  // Функция паузы (для тестов — мгновенная). По умолчанию setTimeout.
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const {
    sessionId,
    meetingId,
    teacherUserId,
    payloadFiles,
    downloadToken,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = defaultSleep,
  } = params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, videoKey: true },
  });
  if (!session) return;

  // Запись уже выгружена ранее — повторно не качаем (идемпотентность).
  if (session.videoKey) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { recordingStatus: 'ready', recordingError: null },
    });
    return;
  }

  // Атомарное «застолбление» обработки (анти-дабл-даунлоад). Две параллельные
  // доставки recording.completed могли обе пройти проверку videoKey===null и
  // оба скачать запись + залить в S3. Через updateMany с условием в WHERE только
  // ОДНА доставка переведёт Session в 'processing' (count===1), остальные получат
  // count===0 (кто-то уже качает/скачал) и выйдут без повторного скачивания.
  const claimed = await prisma.session.updateMany({
    where: {
      id: sessionId,
      videoKey: null,
      OR: [{ recordingStatus: null }, { recordingStatus: { notIn: ['processing', 'ready'] } }],
    },
    data: { recordingStatus: 'processing', recordingError: null },
  });
  if (claimed.count === 0) {
    // Другая доставка уже взяла запись в работу (или успела скачать) — выходим.
    return;
  }

  try {
    let files = payloadFiles ?? [];
    let main = pickMainRecording(files);

    // Если в payload нет файлов или нет подходящего — спросим API Zoom.
    if (!main) {
      files = await getMeetingRecordings(teacherUserId, meetingId);
      main = pickMainRecording(files);
    }

    if (!main || !main.download_url) {
      throw new SafeRecordingError('В записи Zoom нет подходящего видеофайла (MP4)');
    }

    // Скачиваем под download_token из вебхука, если он есть; иначе — OAuth-токен.
    const token = downloadToken ?? (await getZoomAccessToken(teacherUserId));

    // Авто-ретрай транзиентного сбоя скачивания. Файл записи у Zoom может
    // «доезжать» по CDN секунды-минуты после recording.completed → первые
    // попытки дают 401/404/5xx. Повторяем по retryDelaysMs (по умолчанию 20с,
    // 60с) ПЕРЕД пометкой failed. Нетранзиентные ошибки («нет MP4»,
    // «недопустимый хост») не ретраим — они бросятся сразу. Скачивание целиком
    // внутри внешнего try: при финальном провале по-прежнему пишем
    // failed + SafeRecordingError в catch ниже.
    let body: ReadableStream | null = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        body = await fetchRecordingStream(main.download_url, token);
        break;
      } catch (err) {
        // Ретраим только транзиентный HTTP-сбой и пока есть оставшиеся попытки.
        if (isTransientDownloadError(err) && attempt < retryDelaysMs.length) {
          await sleep(retryDelaysMs[attempt]);
          continue;
        }
        throw err;
      }
    }

    const key = `recordings/${sessionId}-${randomUUID()}.mp4`;
    const uploaded = await uploadStream(body, key, 'video/mp4');

    await prisma.session.update({
      where: { id: sessionId },
      data: { videoKey: uploaded.key, recordingStatus: 'ready', recordingError: null },
    });
  } catch (err) {
    // В recordingError пишем ТОЛЬКО обобщённый текст (без сырых URL/тел/хостов).
    await prisma.session.update({
      where: { id: sessionId },
      data: { recordingStatus: 'failed', recordingError: safeRecordingErrorMessage(err) },
    });
    throw err;
  }
}

// Помечает запись занятия ОЖИДАЕМОЙ (recordingStatus='pending') на событии
// meeting.ended. Смысл: между концом созвона и приходом recording.completed Zoom
// обрабатывает облачную запись минуты-часы; без этой пометки проведённое занятие
// показывало студенту ложное «запись недоступна». 'pending' = «запись готовится».
//
// БЕЗОПАСНОСТЬ/ИДЕМПОТЕНТНОСТЬ: переводим в pending ТОЛЬКО когда videoKey ещё нет
// и текущий статус не входит в ['processing','ready','pending','failed'] — то есть
// не перетираем уже идущую/готовую/упавшую/уже помеченную обработку. Условие — в
// WHERE updateMany (атомарно), как в застолблении processing выше.
//
// ВАЖНО: если у занятия не было облачной записи, recording.completed может не прийти
// никогда → статус так и останется 'pending'. Это приемлемо (лучше «готовится», чем
// ложное «недоступна»); таймаут намеренно НЕ городим.
export async function markRecordingPending(params: { sessionId: string }): Promise<void> {
  const { sessionId } = params;
  await prisma.session.updateMany({
    where: {
      id: sessionId,
      videoKey: null,
      OR: [
        { recordingStatus: null },
        { recordingStatus: { notIn: ['processing', 'ready', 'pending', 'failed'] } },
      ],
    },
    data: { recordingStatus: 'pending' },
  });
}

// Собирает текст резюме из объекта Zoom (overview + details). details может быть
// массивом секций { label?, summary? } или строкой — приводим к читаемому тексту.
export function buildSummaryText(summary: ZoomMeetingSummary | null): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.summary_overview && summary.summary_overview.trim()) {
    parts.push(summary.summary_overview.trim());
  }

  const details = summary.summary_details;
  if (typeof details === 'string' && details.trim()) {
    parts.push(details.trim());
  } else if (Array.isArray(details)) {
    for (const item of details) {
      if (!item) continue;
      if (typeof item === 'string') {
        if (item.trim()) parts.push(item.trim());
        continue;
      }
      const rec = item as { label?: unknown; summary?: unknown };
      const label = typeof rec.label === 'string' ? rec.label.trim() : '';
      const text = typeof rec.summary === 'string' ? rec.summary.trim() : '';
      if (label && text) parts.push(`${label}: ${text}`);
      else if (text) parts.push(text);
      else if (label) parts.push(label);
    }
  }

  const joined = parts.join('\n\n').trim();
  return joined.length > 0 ? joined : null;
}

// Обрабатывает событие meeting.summary_completed: пишет Session.summary из AI-резюме.
// Идемпотентность/приоритет ручного ввода: если summarySource === 'manual' — НЕ
// перезатираем (учитель сам ввёл итоги). payloadSummary — резюме из вебхука, если есть.
export async function processSummaryForSession(params: {
  sessionId: string;
  meetingId: string;
  teacherUserId: string;
  payloadSummary?: ZoomMeetingSummary | null;
}): Promise<void> {
  const { sessionId, meetingId, teacherUserId, payloadSummary } = params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, summarySource: true },
  });
  if (!session) return;

  // Ручной ввод приоритетнее автособранного — не перетираем.
  if (session.summarySource === 'manual') return;

  let summary = payloadSummary ?? null;
  const text = buildSummaryText(summary);

  // Если из payload текста не вышло — попробуем API (резюме могло прийти пустым).
  let finalText = text;
  if (!finalText) {
    summary = await getMeetingSummary(teacherUserId, meetingId);
    finalText = buildSummaryText(summary);
  }

  if (!finalText) return; // резюме недоступно — нечего писать

  await prisma.session.update({
    where: { id: sessionId },
    data: { summary: finalText, summarySource: 'zoom_ai' },
  });
}

// Определяет teacherUserId (под чьим OAuth-токеном качать запись) тем же каскадом,
// что и ручной ретрай POST /lessons/:id/sessions/:streamId/recording/retry: реальный
// владелец встречи в БД не хранится, поэтому пробуем:
//   1) преподавателя урока (LessonTeacher) с рабочей Zoom-интеграцией;
//   2) фолбэк null — у свипера нет «текущего админа», поэтому если ни один
//      преподаватель не подходит, занятие пропускаем (вернём null).
// В отличие от роута тут нет request.user, так что фолбэк на админа неприменим —
// без рабочей интеграции скачивание всё равно упало бы.
async function resolveTeacherUserIdForSweep(lessonId: string): Promise<string | null> {
  const teachers = await prisma.lessonTeacher.findMany({
    where: { lessonId },
    select: { userId: true },
  });
  for (const t of teachers) {
    if (await canCreateMeeting(t.userId)) return t.userId;
  }
  return null;
}

// Порог «зависшего processing» (часы): processing + videoKey IS NULL дольше этого
// почти наверняка означает умерший воркер (процесс упал между claim и записью
// результата). Порог большой, чтобы НЕ убить реально идущую долгую загрузку.
const STUCK_PROCESSING_HOURS = Number(process.env.RECORDING_STUCK_PROCESSING_HOURS) || 1;

// Окно (часы) для повторов failed/pending: за пределами окна не долбим — старые
// сбои скорее всего нетранзиентные (нет записи вовсе / удалена на стороне Zoom).
const RECORDING_SWEEP_WINDOW_HOURS = Number(process.env.RECORDING_SWEEP_WINDOW_HOURS) || 24;

// Сколько занятий обрабатывать за один проход свипера (не грузим систему пачкой).
const RECORDING_SWEEP_BATCH = Number(process.env.RECORDING_SWEEP_BATCH) || 20;

// Фоновый свипер «недокачанных» записей Zoom: добирает транзиентные сбои, которые
// не вытянул авто-ретрай внутри обработки (напр. файл доехал по CDN спустя минуты,
// уже после исчерпания ретраев), и реанимирует «зависший processing».
//
// Берёт занятия с привязкой к встрече Zoom (zoomMeetingId != null), у которых:
//   - recordingStatus = 'failed' или 'pending' и updatedAt в окне последних N часов
//     (за окном — скорее нетранзиентный сбой/нет записи, не трогаем);
//   - ЛИБО recordingStatus = 'processing' И videoKey IS NULL И updatedAt старше
//     порога STUCK_PROCESSING_HOURS — «зависший» процесс: сбрасываем в 'failed'
//     (атомарно, чтобы claim в processRecordingForSession снова прошёл), затем
//     запускаем обработку заново.
// Для каждого занятия определяет teacherUserId каскадом (как ручной ретрай) и
// зовёт processRecordingForSession; идемпотентность/claim уже встроены там.
//
// Ошибки на каждом занятии глотаются (свипер/cron не должен падать). Обрабатывает
// не более RECORDING_SWEEP_BATCH занятий за проход.
//
// ВАЖНО про несколько инстансов: при >1 инстансе API два свипера могли бы взять
// одно занятие. Сейчас инстанс ОДИН, поэтому распределённый лок не делаем; claim
// внутри processRecordingForSession всё равно не даст двойного скачивания.
// Возвращает число занятий, по которым запустил обработку (для логов/тестов).
export async function sweepFailedRecordings(params?: {
  now?: Date;
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<number> {
  const now = params?.now ?? new Date();
  const windowStart = new Date(now.getTime() - RECORDING_SWEEP_WINDOW_HOURS * 60 * 60 * 1000);
  const stuckCutoff = new Date(now.getTime() - STUCK_PROCESSING_HOURS * 60 * 60 * 1000);

  const candidates = await prisma.session.findMany({
    where: {
      zoomMeetingId: { not: null },
      videoKey: null,
      OR: [
        // Транзиентные сбои/ожидание в окне — добираем повтором.
        {
          recordingStatus: { in: ['failed', 'pending'] },
          updatedAt: { gte: windowStart },
        },
        // «Зависший» processing — реанимируем (claim снова сможет взять).
        {
          recordingStatus: 'processing',
          updatedAt: { lt: stuckCutoff },
        },
      ],
    },
    select: {
      id: true,
      streamId: true,
      lessonId: true,
      zoomMeetingId: true,
      recordingStatus: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: RECORDING_SWEEP_BATCH,
  });

  let started = 0;
  for (const s of candidates) {
    try {
      if (!s.zoomMeetingId) continue; // защита от гонки (поле могли обнулить)

      // Зависший processing сбрасываем в failed, чтобы claim (updateMany с условием
      // notIn ['processing','ready']) снова прошёл. Условие в WHERE — атомарно: если
      // загрузка вдруг успела дойти до videoKey/ready, count===0 и мы не тронем её.
      if (s.recordingStatus === 'processing') {
        const reset = await prisma.session.updateMany({
          where: {
            id: s.id,
            videoKey: null,
            recordingStatus: 'processing',
            updatedAt: { lt: stuckCutoff },
          },
          data: { recordingStatus: 'failed' },
        });
        if (reset.count === 0) continue; // уже не «зависший» — пропускаем
      }

      const teacherUserId = await resolveTeacherUserIdForSweep(s.lessonId);
      if (!teacherUserId) continue; // некому скачивать (нет рабочей интеграции)

      await processRecordingForSession({
        sessionId: s.id,
        meetingId: s.zoomMeetingId,
        teacherUserId,
        retryDelaysMs: params?.retryDelaysMs,
        sleep: params?.sleep,
      });
      started += 1;
    } catch (err) {
      // Глотаем: один проблемный сессион не должен валить весь проход свипера.
      console.error('[sweep] ошибка обработки записи занятия', s.id, err);
    }
  }

  return started;
}
