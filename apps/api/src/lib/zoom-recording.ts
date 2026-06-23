import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { prisma } from '@platform/db';
import {
  canCreateMeeting,
  getMeetingDetail,
  getMeetingRecordings,
  getMeetingSummary,
  getZoomAccessToken,
  ZoomApiHttpError,
  type ZoomRecordingFile,
  type ZoomMeetingSummary,
} from './zoom.js';
import { uploadStream } from './s3.js';

// Исход обработки записи/итогов/транскрипта. Различаем «формируется» (данных у
// Zoom ещё нет / не готовы — это НЕ ошибка) и «ошибка» (реальный сбой). Нужен
// вызывающему refresh, чтобы показать пользователю «ещё формируется», а не «не
// удалось». Вебхук/свипер исход игнорируют (им важен лишь записанный в БД статус).
//   - 'ready'      — данные получены и сохранены;
//   - 'processing' — у Zoom ещё нет/не готовы (формируется), статус в БД=processing;
//   - 'failed'     — реальная ошибка, статус в БД=failed (функция при этом бросает).
export type ProcessOutcome = 'ready' | 'processing' | 'failed';

// Сущность, чью запись/итоги/транскрипт обрабатываем. 'session' — обычное занятие
// потока (Session), 'meeting' — встреча 1-на-1 (Meeting, эпик #154). Поля Zoom/записи/
// итогов/транскрипта у обеих моделей ИДЕНТИЧНЫ по именам и типам, поэтому один набор
// обработчиков работает для обеих — различается лишь Prisma-делегат. Дефолт 'session'
// сохраняет прежнее поведение всего существующего кода занятий (он kind не передаёт).
export type RecordingKind = 'session' | 'meeting';

// Минимальный структурный интерфейс делегата Prisma, которым пользуются обработчики:
// только findUnique/update/updateMany с нужными нам полями. Session и Meeting оба ему
// удовлетворяют (поля идентичны). Параметры типизированы как Prisma-аргументы (any в
// рамках узкого хелпера) — данные/where, которые мы передаём, валидны для обеих моделей.
/* eslint-disable @typescript-eslint/no-explicit-any */
interface RecordingModelDelegate {
  findUnique(args: { where: { id: string }; select: Record<string, boolean> }): Promise<any>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<any>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{
    count: number;
  }>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Возвращает Prisma-делегат нужной модели по kind. Делегаты Session и Meeting имеют
// совпадающие сигнатуры по используемым здесь полям (findUnique/update/updateMany с
// одинаковым набором select/where/data) — поэтому работаем через узкий структурный тип.
// Это и есть ЕДИНСТВЕННАЯ точка ветвления session↔meeting: ниже весь код общий.
function modelFor(kind: RecordingKind): RecordingModelDelegate {
  return (kind === 'meeting'
    ? prisma.meeting
    : prisma.session) as unknown as RecordingModelDelegate;
}

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

// «Записи у Zoom ещё нет / не готова» — НЕ ошибка, а состояние «формируется».
// Признаём таким ТОЛЬКО 404 на ЛИСТИНГЕ recordings (GET .../recordings вернул
// «нет облачной записи»): Zoom отдаёт 404, пока рендер записи не завершён или
// записи не было вовсе. Прочие коды (403/нет scope/5xx и т.п.) — реальные ошибки
// доступа/системы, их в «формируется» НЕ переводим. Важно: это про листинг
// recordings, а не про СКАЧИВАНИЕ файла (там свой RecordingDownloadHttpError с
// ретраями — его транзиентность тут не трогаем).
function isRecordingsNotReady(err: unknown): boolean {
  return err instanceof ZoomApiHttpError && err.status === 404;
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

// Результат ленивого доезда UUID встречи Zoom (ensureMeetingUuid):
//   - uuid — UUID встречи (исходный, либо добытый getMeetingDetail), либо null;
//   - detailFailed — getMeetingDetail упал РЕАЛЬНОЙ ошибкой (403/5xx). Отличаем
//     это от «UUID просто нет» (uuid=null, detailFailed=false): на реальной ошибке
//     вызывающий помечает «формируется» (данные пока недоступны), НЕ запрашивая
//     запись/итоги по заведомо неподходящему id.
interface EnsureUuidResult {
  uuid: string | null;
  detailFailed: boolean;
}

// ЕДИНАЯ точка ленивого доезда UUID встречи Zoom (#185 → #188). UUID нужен запросам
// записи/транскрипта/итогов: у прошедшей встречи (особенно 1-на-1) эти данные у Zoom
// доступны по UUID, а числовой id отдаёт 404/400. Для встреч/занятий, созданных ДО
// захвата UUID (zoomMeetingUuid=null) и не докрученных вебхуком, добираем UUID:
// GET /meetings/{numericId} → uuid, и идемпотентно сохраняем его в модель
// (Session/Meeting), чтобы следующие запросы шли по UUID без повторного доезда.
//
// Возврат (НЕ бросает — вызывающий сам решает статус):
//   - { uuid: <известный/добытый>, detailFailed: false } — UUID есть;
//   - { uuid: null, detailFailed: false } — UUID нет (Zoom не отдал / 404 деталей):
//     вызывающий пробует фолбэк на числовой meetingId;
//   - { uuid: null, detailFailed: true } — getMeetingDetail упал реальной ошибкой
//     (403/5xx): вызывающий трактует как «формируется» и не дёргает запись/итоги.
async function ensureMeetingUuid(
  model: RecordingModelDelegate,
  sessionId: string,
  currentUuid: string | null | undefined,
  meetingId: string,
  teacherUserId: string,
): Promise<EnsureUuidResult> {
  if (currentUuid) return { uuid: currentUuid, detailFailed: false };

  try {
    const detail = await getMeetingDetail(teacherUserId, meetingId);
    if (detail.uuid) {
      // Сохраняем добытый UUID — только если поле ещё пусто (не перетираем ранее
      // захваченный UUID). Дальше вебхук/refresh/свипер пойдут по UUID без доезда.
      await model.updateMany({
        where: { id: sessionId, zoomMeetingUuid: null },
        data: { zoomMeetingUuid: detail.uuid },
      });
      return { uuid: detail.uuid, detailFailed: false };
    }
    // 404 деталей getMeetingDetail уже вернул бы { uuid: null } — сюда: Zoom отдал
    // детали без UUID. UUID не добыт, но это и не реальный сбой → фолбэк на числовой.
    return { uuid: null, detailFailed: false };
  } catch {
    // Реальная ошибка доступа (403/5xx) при запросе деталей встречи. Не валим жёстко:
    // сигналим detailFailed — вызывающий пометит «формируется». Свипер/повтор добёрут.
    return { uuid: null, detailFailed: true };
  }
}

// Обрабатывает событие recording.completed: скачивает основной MP4 и заливает в S3.
// `payloadFiles` — recording_files из вебхука (если есть); иначе тянем через API.
// Идемпотентность: если у Session уже стоит videoKey — выходим, не перезаписывая.
//
// СТАТУСЫ (recordingStatus):
//   - успех (скачали+залили) → 'ready';
//   - записи у Zoom ЕЩЁ НЕТ / не готова (пустой листинг, нет MP4 при незавершённом
//     рендере, 404 на GET .../recordings) → 'processing' (ФОРМИРУЕТСЯ), без ошибки
//     и БЕЗ throw — это не сбой, данные ещё готовятся;
//   - РЕАЛЬНАЯ ошибка (403/нет scope, недопустимый хост, повторные сбои СКАЧИВАНИЯ
//     файла после ретраев, системные) → 'failed' + safeRecordingError, и throw.
// Возвращает ProcessOutcome ('ready'|'processing'|'failed'-через-throw), чтобы
// вызывающий refresh показал «ещё формируется» вместо «не удалось». Вебхук/свипер
// возврат игнорируют (им важен записанный в БД статус).
export async function processRecordingForSession(params: {
  sessionId: string;
  meetingId: string;
  teacherUserId: string;
  payloadFiles?: ZoomRecordingFile[] | null;
  // UUID встречи Zoom — листинг recordings у прошедшей встречи (особенно 1-на-1)
  // доступен по UUID, а числовой id отдаёт 404. При наличии UUID используем его;
  // иначе общий хелпер ensureMeetingUuid лениво добирает его, иначе фолбэк на
  // числовой meetingId. Передаётся из рефреш-роутов (как у summary, #188).
  meetingUuid?: string | null;
  // download_token из вебхука recording.completed — короткоживущий токен Zoom,
  // выданный специально для скачивания файлов этого события. Предпочитаем его
  // OAuth-токену аккаунта; у ручного ретрая его нет — там фолбэк на OAuth-токен.
  downloadToken?: string | null;
  // Паузы между авто-ретраями транзиентного сбоя скачивания (мс). По умолчанию
  // реальный backoff (20с, 60с). В тестах передаём [] или нули, чтобы не ждать.
  retryDelaysMs?: number[];
  // Функция паузы (для тестов — мгновенная). По умолчанию setTimeout.
  sleep?: (ms: number) => Promise<void>;
  // Сущность: занятие (Session) или встреча 1-на-1 (Meeting). Дефолт 'session' —
  // существующий код занятий kind не передаёт и работает как раньше.
  kind?: RecordingKind;
}): Promise<ProcessOutcome> {
  const {
    sessionId,
    meetingId,
    teacherUserId,
    payloadFiles,
    meetingUuid,
    downloadToken,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = defaultSleep,
    kind = 'session',
  } = params;
  const model = modelFor(kind);

  const session = await model.findUnique({
    where: { id: sessionId },
    select: { id: true, videoKey: true },
  });
  if (!session) return 'processing';

  // Запись уже выгружена ранее — повторно не качаем (идемпотентность).
  if (session.videoKey) {
    await model.update({
      where: { id: sessionId },
      data: { recordingStatus: 'ready', recordingError: null },
    });
    return 'ready';
  }

  // Атомарное «застолбление» обработки (анти-дабл-даунлоад). Две параллельные
  // доставки recording.completed могли обе пройти проверку videoKey===null и
  // оба скачать запись + залить в S3. Через updateMany с условием в WHERE только
  // ОДНА доставка переведёт Session в 'processing' (count===1), остальные получат
  // count===0 (кто-то уже качает/скачал) и выйдут без повторного скачивания.
  const claimed = await model.updateMany({
    where: {
      id: sessionId,
      videoKey: null,
      OR: [{ recordingStatus: null }, { recordingStatus: { notIn: ['processing', 'ready'] } }],
    },
    data: { recordingStatus: 'processing', recordingError: null },
  });
  if (claimed.count === 0) {
    // Другая доставка уже взяла запись в работу (или успела скачать) — выходим.
    // Для refresh это «идёт обработка» → 'processing' (не успех и не ошибка).
    return 'processing';
  }

  try {
    let files = payloadFiles ?? [];
    let main = pickMainRecording(files);

    // Если в payload нет файлов или нет подходящего — спросим API Zoom. 404 на
    // листинге recordings = облачной записи ЕЩЁ НЕТ (рендер не завершён / не было):
    // это «формируется», а не ошибка — статус оставляем 'processing' и выходим.
    if (!main) {
      // Листинг recordings у прошедшей встречи доступен по UUID (числовой id → 404).
      // Доезд UUID — общий хелпер (как у summary/transcript, #188). detailFailed
      // (реальная ошибка деталей) → «формируется», запрос не дёргаем по плохому id.
      const ensured = await ensureMeetingUuid(
        model,
        sessionId,
        meetingUuid,
        meetingId,
        teacherUserId,
      );
      if (ensured.detailFailed) {
        await model.update({
          where: { id: sessionId },
          data: { recordingStatus: 'processing', recordingError: null },
        });
        return 'processing';
      }
      // UUID предпочтительнее (запись по нему доступна); иначе фолбэк на числовой id.
      const recordingsId = ensured.uuid ?? meetingId;
      try {
        files = await getMeetingRecordings(teacherUserId, recordingsId);
      } catch (err) {
        if (isRecordingsNotReady(err)) {
          // Записи у Zoom ещё нет — данные формируются, не failed.
          await model.update({
            where: { id: sessionId },
            data: { recordingStatus: 'processing', recordingError: null },
          });
          return 'processing';
        }
        throw err;
      }
      main = pickMainRecording(files);
    }

    // Записи нет вовсе (пустой листинг) или MP4 ещё не отрендерился (есть другие
    // файлы, но нет подходящего видео) — рендер не завершён → ФОРМИРУЕТСЯ, не сбой.
    if (!main || !main.download_url) {
      await model.update({
        where: { id: sessionId },
        data: { recordingStatus: 'processing', recordingError: null },
      });
      return 'processing';
    }

    // Скачиваем под download_token из вебхука, если он есть; иначе — OAuth-токен.
    const token = downloadToken ?? (await getZoomAccessToken(teacherUserId));

    // Авто-ретрай транзиентного сбоя скачивания. Файл записи у Zoom может
    // «доезжать» по CDN секунды-минуты после recording.completed → первые
    // попытки дают 401/404/5xx. Повторяем по retryDelaysMs (по умолчанию 20с,
    // 60с) ПЕРЕД пометкой failed. Нетранзиентные ошибки («недопустимый хост»,
    // 403) не ретраим — они бросятся сразу. Скачивание целиком внутри внешнего
    // try: при финальном провале СКАЧИВАНИЯ пишем failed + SafeRecordingError в
    // catch ниже (повторный сбой скачивания файла — это уже реальная ошибка).
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

    await model.update({
      where: { id: sessionId },
      data: { videoKey: uploaded.key, recordingStatus: 'ready', recordingError: null },
    });
    return 'ready';
  } catch (err) {
    // Сюда попадают РЕАЛЬНЫЕ ошибки: повторный сбой скачивания файла после ретраев
    // (RecordingDownloadHttpError), недопустимый хост, 403/нет scope на листинге,
    // системные сбои. В recordingError — ТОЛЬКО обобщённый текст (без сырых
    // URL/тел/хостов).
    await model.update({
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
//
// recordingRequestedAt=now(): фиксируем МОМЕНТ ожидания записи. Фронт по нему
// отличит «формируется» (ждём недолго) от «недоступно по таймауту» (ждём слишком
// долго). Ставится здесь же атомарно: WHERE не пускает повторный meeting.ended
// (статус уже 'pending'/иной) → отметка фиксируется один раз и не перетирается.
export async function markRecordingPending(params: {
  sessionId: string;
  now?: Date;
  kind?: RecordingKind;
}): Promise<void> {
  const { sessionId, now = new Date(), kind = 'session' } = params;
  await modelFor(kind).updateMany({
    where: {
      id: sessionId,
      videoKey: null,
      OR: [
        { recordingStatus: null },
        { recordingStatus: { notIn: ['processing', 'ready', 'pending', 'failed'] } },
      ],
    },
    data: { recordingStatus: 'pending', recordingRequestedAt: now },
  });
}

// Помечает итоги занятия ОЖИДАЕМЫМИ (summaryStatus='pending') на meeting.ended.
// Смысл тот же, что у markRecordingPending: между концом созвона и приходом
// meeting.summary_completed AI Companion обрабатывает резюме минуты — без пометки
// UI показывал бы ложное «итогов нет».
//
// БЕЗОПАСНОСТЬ/ИДЕМПОТЕНТНОСТЬ (атомарно через WHERE updateMany):
//   - НЕ трогаем ручной ввод итогов (summarySource='manual') — там свой источник;
//   - переводим в pending только если статус не входит в
//     ['processing','ready','pending','failed'] (не перетираем идущую/готовую/
//     упавшую/уже помеченную обработку).
//
// summaryRequestedAt=now(): фиксируем момент ожидания итогов (как у записи) — фронт
// отличит «формируется» от «недоступно по таймауту». WHERE не пускает повторный
// meeting.ended → отметка фиксируется один раз.
export async function markSummaryPending(params: {
  sessionId: string;
  now?: Date;
  kind?: RecordingKind;
}): Promise<void> {
  const { sessionId, now = new Date(), kind = 'session' } = params;
  await modelFor(kind).updateMany({
    where: {
      id: sessionId,
      NOT: { summarySource: 'manual' },
      OR: [
        { summaryStatus: null },
        { summaryStatus: { notIn: ['processing', 'ready', 'pending', 'failed'] } },
      ],
    },
    data: { summaryStatus: 'pending', summaryRequestedAt: now },
  });
}

// Помечает транскрипт занятия ОЖИДАЕМЫМ (transcriptStatus='pending') на meeting.ended
// и фиксирует transcriptRequestedAt=now() — момент запроса, от которого считается
// увеличенный таймаут до 'failed' (транскрипт у Zoom готовится ДОЛЬШЕ записи, и
// событие recording.transcript_completed приходит заметно позже).
//
// Атомарно через WHERE updateMany: переводим в pending только когда ключа .vtt ещё
// нет (transcriptVttKey IS NULL) и статус не входит в
// ['processing','ready','pending','failed'] (не перетираем идущую/готовую/упавшую/
// уже помеченную обработку).
export async function markTranscriptPending(params: {
  sessionId: string;
  now?: Date;
  kind?: RecordingKind;
}): Promise<void> {
  const { sessionId, now = new Date(), kind = 'session' } = params;
  await modelFor(kind).updateMany({
    where: {
      id: sessionId,
      transcriptVttKey: null,
      OR: [
        { transcriptStatus: null },
        { transcriptStatus: { notIn: ['processing', 'ready', 'pending', 'failed'] } },
      ],
    },
    data: { transcriptStatus: 'pending', transcriptRequestedAt: now },
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
//
// СТАТУСЫ (summaryStatus):
//   - успех с текстом → 'ready';
//   - резюме ЕЩЁ НЕТ / не готово (пустой ответ, 404/недоступно от API — getMeetingSummary
//     вернул null) → 'processing' (ФОРМИРУЕТСЯ), БЕЗ throw. Это не сбой: AI Companion
//     готовит резюме минуты, и при ручной подтяжке до готовности было бы ложное «итоги
//     не получены»;
//   - РЕАЛЬНАЯ ошибка (403/нет scope, 5xx — getMeetingSummary бросает) → 'failed' + throw.
// Ручной ввод итогов статус НЕ трогаем (там свой источник — summarySource='manual').
// Возврат ProcessOutcome — для refresh («формируется» vs «не удалось»).
export async function processSummaryForSession(params: {
  sessionId: string;
  meetingId: string;
  teacherUserId: string;
  payloadSummary?: ZoomMeetingSummary | null;
  // UUID встречи Zoom — meeting_summary не принимает числовой id, поэтому при
  // наличии UUID используем его; иначе фолбэк на числовой meetingId.
  meetingUuid?: string | null;
  kind?: RecordingKind;
}): Promise<ProcessOutcome> {
  const { sessionId, meetingId, teacherUserId, payloadSummary, meetingUuid, kind = 'session' } =
    params;
  const model = modelFor(kind);

  const session = await model.findUnique({
    where: { id: sessionId },
    select: { id: true, summarySource: true },
  });
  if (!session) return 'processing';

  // Ручной ввод приоритетнее автособранного — не перетираем (и статус не трогаем).
  if (session.summarySource === 'manual') return 'ready';

  let summary = payloadSummary ?? null;
  const text = buildSummaryText(summary);

  // Если из payload текста не вышло — попробуем API (резюме могло прийти пустым).
  // getMeetingSummary: null = ещё не готово/недоступно (404/400) → формируется;
  // throw = реальная ошибка (403/5xx) → failed.
  let finalText = text;
  if (!finalText) {
    // meeting_summary не принимает числовой id — нужен UUID встречи. Доезд UUID для
    // встреч, созданных ДО его захвата (zoomMeetingUuid=null), — ОБЩИЙ хелпер
    // ensureMeetingUuid (та же логика у записи и транскрипта, #188). Это чинит уже
    // существующую встречу заказчика, не дожидаясь вебхука.
    const ensured = await ensureMeetingUuid(
      model,
      sessionId,
      meetingUuid,
      meetingId,
      teacherUserId,
    );
    if (ensured.detailFailed) {
      // Доезд UUID упал реальной ошибкой (403/5xx) — итоги по неподходящему id не
      // запрашиваем. Помечаем «формируется» (НЕ бросаем 400/прочее в лицо).
      await model.update({
        where: { id: sessionId },
        data: { summaryStatus: 'processing' },
      });
      return 'processing';
    }
    const effectiveUuid = ensured.uuid;

    try {
      // UUID предпочтительнее: meeting_summary не принимает числовой id. Если UUID
      // так и не добыли — пробуем числовой meetingId как фолбэк; getMeetingSummary
      // на 400 «Invalid meeting id» вернёт null (→ processing), а не бросит.
      const summaryId = effectiveUuid ?? meetingId;
      summary = await getMeetingSummary(teacherUserId, summaryId);
    } catch (err) {
      await model.update({
        where: { id: sessionId },
        data: { summaryStatus: 'failed' },
      });
      throw err;
    }
    finalText = buildSummaryText(summary);
  }

  if (!finalText) {
    // Резюме ещё нет / не готово — ФОРМИРУЕТСЯ, статус 'processing' (НЕ failed).
    // Текст summary не трогаем (могло быть проставлено ранее иным путём).
    await model.update({
      where: { id: sessionId },
      data: { summaryStatus: 'processing' },
    });
    return 'processing';
  }

  await model.update({
    where: { id: sessionId },
    data: { summary: finalText, summarySource: 'zoom_ai', summaryStatus: 'ready' },
  });
  return 'ready';
}

// ---------------------------------------------------------------------------
// Транскрипт занятия (.VTT → .TXT). Дословная расшифровка созвона из Zoom Cloud
// Recording. В отличие от записи (видео) и итогов (AI-резюме) — это отдельный
// файл-транскрипт (recording_type='audio_transcript' / file_type='TRANSCRIPT').
// ---------------------------------------------------------------------------

// Выбирает файл транскрипта из списка файлов записи Zoom: предпочитаем
// recording_type==='audio_transcript', иначе file_type==='TRANSCRIPT', и в любом
// случае требуем download_url (без ссылки скачивать нечего). null, если нет.
export function pickTranscriptFile(
  files: ZoomRecordingFile[] | undefined | null,
): ZoomRecordingFile | null {
  if (!files || files.length === 0) return null;

  const byRecordingType = files.find(
    (f) => f.recording_type === 'audio_transcript' && f.download_url,
  );
  if (byRecordingType) return byRecordingType;

  const byFileType = files.find(
    (f) => (f.file_type ?? '').toUpperCase() === 'TRANSCRIPT' && f.download_url,
  );
  return byFileType ?? null;
}

// Парсит WebVTT в чистый текст реплик: убирает заголовок WEBVTT (и NOTE/STYLE/
// REGION-блоки), номера-«кью» и строки таймкодов (вида 00:00:01.000 --> 00:00:03.000),
// схлопывает дубли подряд (Zoom иногда повторяет реплику). Склеивает реплики через
// перевод строки. Возвращает пустую строку, если значимого текста нет.
export function parseVttToText(vtt: string): string {
  // Нормализуем переводы строк; режем BOM в начале (Zoom иногда отдаёт UTF-8 BOM).
  const normalized = vtt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  // Строка таймкода кью: "00:00:01.000 --> 00:00:03.000" (опц. позиционные настройки).
  const timecodeRe = /-->/;
  // Строка-номер кью (целое число, иногда с пробелами).
  const cueNumberRe = /^\d+$/;

  const out: string[] = [];
  let prev: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Заголовок WEBVTT (возможно с суффиксом после пробела).
    if (/^WEBVTT\b/.test(line)) continue;
    // Метаданные/служебные блоки.
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (timecodeRe.test(line)) continue;
    if (cueNumberRe.test(line)) continue;

    // Дедуп идущих подряд одинаковых реплик.
    if (line === prev) continue;
    out.push(line);
    prev = line;
  }

  return out.join('\n').trim();
}

// Заливает текстовый контент в S3 по заданному ключу через стримовую загрузку
// (uploadStream принимает Readable — оборачиваем строку в поток). Возвращает ключ.
async function uploadTextToS3(
  content: string,
  key: string,
  contentType: string,
): Promise<string> {
  const stream = Readable.from([Buffer.from(content, 'utf8')]);
  const uploaded = await uploadStream(stream, key, contentType);
  return uploaded.key;
}

// Обрабатывает событие recording.transcript_completed (а также фолбэк-попытку на
// recording.completed, если транскрипт уже есть в recording_files): скачивает .vtt,
// заливает сырой .vtt и очищенный .txt в S3, проставляет ключи и transcriptStatus.
//
// ПОВЕДЕНИЕ (transcriptStatus):
//   - Файла транскрипта ещё нет (часто на recording.completed — транскрипт приходит
//     позже; или 404 на листинге recordings) — выходим БЕЗ пометки failed: это
//     ФОРМИРУЕТСЯ. Статус не ломаем (остаётся 'pending' от markTranscriptPending),
//     возвращаем 'processing' (для refresh — «ещё формируется»).
//   - Claim атомарно (анти-дабл-даунлоад): updateMany WHERE transcriptVttKey IS NULL
//     и transcriptStatus NOT IN ('processing','ready') → set 'processing'. Идемпотентно:
//     повторная доставка увидит count===0 и выйдет.
//   - Скачивание тем же fetchRecordingStream (анти-SSRF, ?access_token, ретраи).
//   - Успех → transcriptVttKey/transcriptTxtKey + transcriptStatus='ready'.
//   - РЕАЛЬНАЯ ошибка (повторный сбой СКАЧИВАНИЯ после ретраев, недопустимый хост,
//     403/5xx на листинге) → transcriptStatus='failed' + безопасный transcriptError
//     (без сырых URL/тел) + throw. Вызывающий fire-and-forget ловит/логирует.
export async function processTranscriptForSession(params: {
  sessionId: string;
  meetingId: string;
  teacherUserId: string;
  payloadFiles?: ZoomRecordingFile[] | null;
  // UUID встречи Zoom — листинг recordings (откуда берём файл транскрипта) у
  // прошедшей встречи доступен по UUID, а числовой id отдаёт 404. При наличии UUID
  // используем его; иначе общий хелпер ensureMeetingUuid лениво добирает; иначе
  // фолбэк на числовой meetingId. Передаётся из рефреш-роутов (как у summary, #188).
  meetingUuid?: string | null;
  // download_token из вебхука (короткоживущий токен для скачивания файлов события).
  downloadToken?: string | null;
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  kind?: RecordingKind;
}): Promise<ProcessOutcome> {
  const {
    sessionId,
    meetingId,
    teacherUserId,
    payloadFiles,
    meetingUuid,
    downloadToken,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = defaultSleep,
    kind = 'session',
  } = params;
  const model = modelFor(kind);

  const session = await model.findUnique({
    where: { id: sessionId },
    select: { id: true, transcriptVttKey: true },
  });
  if (!session) return 'processing';

  // Транскрипт уже выгружен ранее — повторно не качаем (идемпотентность).
  if (session.transcriptVttKey) {
    await model.update({
      where: { id: sessionId },
      data: { transcriptStatus: 'ready', transcriptError: null },
    });
    return 'ready';
  }

  // Сначала ищем файл транскрипта в payload; если его там нет — спросим API Zoom.
  // ВАЖНО: проверку наличия файла делаем ДО claim, чтобы на recording.completed
  // (где транскрипта обычно ещё нет) не «застолбить» статус впустую и не сломать
  // последующую обработку recording.transcript_completed. 404 на листинге = записи
  // ещё нет → транскрипт тоже ФОРМИРУЕТСЯ (не ошибка).
  let files = payloadFiles ?? [];
  let transcriptFile = pickTranscriptFile(files);
  if (!transcriptFile) {
    // Листинг recordings у прошедшей встречи доступен по UUID (числовой id → 404).
    // Доезд UUID — общий хелпер (как у summary/recording, #188). detailFailed
    // (реальная ошибка деталей) → «формируется», статус НЕ ломаем.
    const ensured = await ensureMeetingUuid(
      model,
      sessionId,
      meetingUuid,
      meetingId,
      teacherUserId,
    );
    if (ensured.detailFailed) return 'processing';
    // UUID предпочтительнее; иначе фолбэк на числовой id.
    const recordingsId = ensured.uuid ?? meetingId;
    try {
      files = await getMeetingRecordings(teacherUserId, recordingsId);
    } catch (err) {
      if (isRecordingsNotReady(err)) {
        // Записи/транскрипта у Zoom ещё нет — формируется, статус НЕ ломаем.
        return 'processing';
      }
      throw err;
    }
    transcriptFile = pickTranscriptFile(files);
  }
  if (!transcriptFile || !transcriptFile.download_url) {
    // Нечего тянуть (транскрипт ещё не готов / не включён) — статус НЕ ломаем,
    // это ФОРМИРУЕТСЯ (не failed). Окончательно добёрет recording.transcript_completed.
    return 'processing';
  }

  // Атомарное застолбление обработки (анти-дабл-даунлоад) — как у записи.
  const claimed = await model.updateMany({
    where: {
      id: sessionId,
      transcriptVttKey: null,
      OR: [
        { transcriptStatus: null },
        { transcriptStatus: { notIn: ['processing', 'ready'] } },
      ],
    },
    data: { transcriptStatus: 'processing', transcriptError: null },
  });
  if (claimed.count === 0) {
    // Другая доставка уже взяла транскрипт в работу (или успела выгрузить) — выходим.
    return 'processing';
  }

  try {
    const token = downloadToken ?? (await getZoomAccessToken(teacherUserId));

    // Скачиваем .vtt с авто-ретраем транзиентного сбоя (файл может «доезжать» по CDN).
    let body: ReadableStream | null = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        body = await fetchRecordingStream(transcriptFile.download_url, token);
        break;
      } catch (err) {
        if (isTransientDownloadError(err) && attempt < retryDelaysMs.length) {
          await sleep(retryDelaysMs[attempt]);
          continue;
        }
        throw err;
      }
    }

    // Транскрипт небольшой — буферизуем целиком, чтобы и залить сырой .vtt, и
    // распарсить в .txt. (Записи Zoom стримятся, а текст расшифровки умещается в память.)
    const vttText = await streamToString(body as ReadableStream);
    const txtText = parseVttToText(vttText);

    const uuid = randomUUID();
    const vttKey = `transcript/${sessionId}-${uuid}.vtt`;
    const txtKey = `transcript/${sessionId}-${uuid}.txt`;

    const savedVttKey = await uploadTextToS3(vttText, vttKey, 'text/vtt; charset=utf-8');
    const savedTxtKey = await uploadTextToS3(txtText, txtKey, 'text/plain; charset=utf-8');

    await model.update({
      where: { id: sessionId },
      data: {
        transcriptVttKey: savedVttKey,
        transcriptTxtKey: savedTxtKey,
        transcriptStatus: 'ready',
        transcriptError: null,
      },
    });
    return 'ready';
  } catch (err) {
    // Сюда — РЕАЛЬНЫЕ ошибки (повторный сбой скачивания после ретраев, недопустимый
    // хост, системные). В transcriptError — ТОЛЬКО обобщённый текст (без URL/тел/хостов).
    await model.update({
      where: { id: sessionId },
      data: { transcriptStatus: 'failed', transcriptError: safeTranscriptErrorMessage(err) },
    });
    throw err;
  }
}

// Текст для transcriptError: для «безопасных» ошибок (SafeRecordingError, в т.ч.
// HTTP-код скачивания) — как есть; иначе обобщённо (системную ошибку с сырыми
// деталями наружу не пускаем).
function safeTranscriptErrorMessage(err: unknown): string {
  if (err instanceof SafeRecordingError) return err.message;
  return 'Не удалось обработать транскрипт Zoom';
}

// Считывает web ReadableStream целиком в строку (UTF-8). Используется для
// транскрипта (небольшой текстовый файл — буферизация в память приемлема).
async function streamToString(stream: ReadableStream): Promise<string> {
  const nodeStream = Readable.fromWeb(stream as never);
  const chunks: Buffer[] = [];
  for await (const chunk of nodeStream) {
    // chunk из Node Readable — Buffer (или string при объектном режиме, чего тут
    // нет). Нормализуем к Buffer для корректной склейки UTF-8.
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
  }
  return Buffer.concat(chunks).toString('utf8');
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

  // Общий WHERE-отбор кандидатов на досбор записи (одинаков для Session и Meeting —
  // поля zoomMeetingId/videoKey/recordingStatus/updatedAt у обеих моделей идентичны).
  const sweepWhere = {
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
  };

  let started = 0;

  // ── Проход по занятиям потока (Session) ──────────────────────────────────────
  const sessions = await prisma.session.findMany({
    where: sweepWhere,
    select: {
      id: true,
      streamId: true,
      lessonId: true,
      zoomMeetingId: true,
      zoomMeetingUuid: true,
      recordingStatus: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: RECORDING_SWEEP_BATCH,
  });

  for (const s of sessions) {
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
        meetingUuid: s.zoomMeetingUuid,
        retryDelaysMs: params?.retryDelaysMs,
        sleep: params?.sleep,
      });
      started += 1;
    } catch (err) {
      // Глотаем: один проблемный сессион не должен валить весь проход свипера.
      console.error('[sweep] ошибка обработки записи занятия', s.id, err);
    }
  }

  // ── Проход по встречам 1-на-1 (Meeting, эпик #154) ───────────────────────────
  // Зеркало прохода по Session, но teacherUserId берём напрямую из Meeting.teacherId
  // (реальный владелец встречи хранится в БД — каскад resolveTeacherUserIdForSweep,
  // нужный занятиям, тут не требуется). Обработка — теми же функциями с kind='meeting'.
  const meetings = await prisma.meeting.findMany({
    where: sweepWhere,
    select: {
      id: true,
      teacherId: true,
      zoomMeetingId: true,
      zoomMeetingUuid: true,
      recordingStatus: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: RECORDING_SWEEP_BATCH,
  });

  for (const m of meetings) {
    try {
      if (!m.zoomMeetingId) continue; // защита от гонки (поле могли обнулить)

      // Зависший processing → failed (атомарно через WHERE), чтобы claim снова прошёл.
      if (m.recordingStatus === 'processing') {
        const reset = await prisma.meeting.updateMany({
          where: {
            id: m.id,
            videoKey: null,
            recordingStatus: 'processing',
            updatedAt: { lt: stuckCutoff },
          },
          data: { recordingStatus: 'failed' },
        });
        if (reset.count === 0) continue; // уже не «зависший» — пропускаем
      }

      await processRecordingForSession({
        sessionId: m.id,
        meetingId: m.zoomMeetingId,
        teacherUserId: m.teacherId,
        meetingUuid: m.zoomMeetingUuid,
        retryDelaysMs: params?.retryDelaysMs,
        sleep: params?.sleep,
        kind: 'meeting',
      });
      started += 1;
    } catch (err) {
      // Глотаем: одна проблемная встреча не должна валить весь проход свипера.
      console.error('[sweep] ошибка обработки записи встречи 1-на-1', m.id, err);
    }
  }

  return started;
}
