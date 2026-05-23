import { randomUUID } from 'node:crypto';
import { prisma } from '@platform/db';
import {
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
  accessToken: string,
): Promise<ReadableStream> {
  if (!isAllowedZoomDownloadUrl(downloadUrl)) {
    throw new SafeRecordingError('Недопустимый хост ссылки на запись Zoom');
  }
  // Bearer уходит только на проверенный хост Zoom (первый хоп). При кросс-доменном
  // редиректе на хранилище Zoom fetch по спецификации срезает Authorization —
  // токен не утекает, а легитимная загрузка по редиректу не ломается.
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok || !res.body) {
    // Только статус, без URL/тела ответа Zoom.
    throw new SafeRecordingError(`Не удалось скачать запись Zoom (HTTP ${res.status})`);
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
}): Promise<void> {
  const { sessionId, meetingId, teacherUserId, payloadFiles } = params;

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

    const accessToken = await getZoomAccessToken(teacherUserId);
    const body = await fetchRecordingStream(main.download_url, accessToken);

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
