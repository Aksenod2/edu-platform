import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@platform/db';
import { decryptSecret, isEncryptionKeySet } from './crypto.js';

// Интеграция с Zoom через Server-to-Server OAuth.
// Конфиг хранится пер-преподаватель: одна строка ZoomIntegration на userId.

const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token';
const ZOOM_API_URL = 'https://api.zoom.us/v2';

// Возвращает настройки Zoom конкретного пользователя (или null, если ещё не созданы).
export function getZoomIntegration(userId: string) {
  return prisma.zoomIntegration.findUnique({ where: { userId } });
}

interface ZoomTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

// Получает access_token по Server-to-Server OAuth.
// POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=<accountId>
// с заголовком Authorization: Basic base64(clientId:clientSecret).
// Секрет хранится зашифрованным — расшифровываем перед использованием.
// Бросает Error при отсутствии/неполноте конфига или ошибке Zoom.
export async function getZoomAccessToken(userId: string): Promise<string> {
  const integration = await getZoomIntegration(userId);
  if (!integration) {
    throw new Error('Интеграция Zoom не настроена');
  }
  const { accountId, clientId, clientSecretEnc } = integration;
  if (!accountId || !clientId || !clientSecretEnc) {
    throw new Error('Не заполнены реквизиты Zoom (Account ID, Client ID, Client Secret)');
  }

  // Расшифровка секрета может бросить, если ключ шифрования не настроен.
  const clientSecret = decryptSecret(clientSecretEnc);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const url = `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(
    accountId,
  )}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { reason?: string; error?: string };
      detail = body.reason || body.error || '';
    } catch {
      // тело может быть не JSON — игнорируем
    }
    throw new Error(
      `Zoom вернул ошибку авторизации (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  const data = (await res.json()) as ZoomTokenResponse;
  if (!data.access_token) {
    throw new Error('Zoom не вернул access_token');
  }
  return data.access_token;
}

interface ZoomMeetingResponse {
  id?: number | string;
  join_url?: string;
}

// Создаёт встречу Zoom под аккаунтом пользователя (S2S-приложение на его аккаунте,
// поэтому POST /users/me/meetings создаёт именно на его аккаунте).
// type: 2 — встреча с фиксированным временем (есть startTime), иначе 1 — мгновенная.
// startTime — ISO без зоны ('YYYY-MM-DDTHH:MM:00'), интерпретируется в timezone.
// Бросает Error при неуспехе — вызывающий оборачивает в try/catch и не падает.
// Возвращает joinUrl и meetingId (числовой id Zoom, храним строкой).
export async function createZoomMeeting(
  userId: string,
  params: { topic: string; startTime: string | null; durationMinutes?: number },
): Promise<{ joinUrl: string; meetingId: string }> {
  const token = await getZoomAccessToken(userId);

  const body: Record<string, unknown> = {
    topic: params.topic,
    type: params.startTime ? 2 : 1,
    duration: params.durationMinutes ?? 60,
    timezone: 'Europe/Moscow',
    settings: {
      join_before_host: true,
      waiting_room: false,
    },
  };
  if (params.startTime) {
    body.start_time = params.startTime;
  }

  const res = await fetch(`${ZOOM_API_URL}/users/me/meetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { message?: string };
      detail = errBody.message || '';
    } catch {
      // тело может быть не JSON — игнорируем
    }
    throw new Error(
      `Zoom вернул ошибку при создании встречи (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  const data = (await res.json()) as ZoomMeetingResponse;
  if (!data.join_url) {
    throw new Error('Zoom не вернул join_url');
  }
  if (data.id === undefined || data.id === null) {
    throw new Error('Zoom не вернул id встречи');
  }
  return { joinUrl: data.join_url, meetingId: String(data.id) };
}

// Удаляет встречу Zoom под аккаунтом пользователя.
// DELETE https://api.zoom.us/v2/meetings/{meetingId} (Bearer).
// Best-effort: вызывающий (отмена занятия) оборачивает в try/catch и НЕ валит
// операцию при ошибке Zoom. 404 («встречи уже нет») трактуем как успех —
// результат тот же. На прочие ошибки бросаем Error, чтобы вызывающий залогировал.
export async function deleteZoomMeeting(userId: string, meetingId: string): Promise<void> {
  const token = await getZoomAccessToken(userId);

  const res = await fetch(`${ZOOM_API_URL}/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  // 204 — удалено; 404 — встречи уже нет (тот же итог) — оба считаем успехом.
  if (res.ok || res.status === 404) return;

  let detail = '';
  try {
    const errBody = (await res.json()) as { message?: string };
    detail = errBody.message || '';
  } catch {
    // тело может быть не JSON — игнорируем
  }
  throw new Error(
    `Zoom вернул ошибку при удалении встречи (${res.status})${detail ? `: ${detail}` : ''}`,
  );
}

// Технически ли возможно создать встречу Zoom для пользователя (БЕЗ учёта тумблера
// автосоздания): интеграция включена, заполнены все реквизиты и настроен ключ
// шифрования (без него не расшифровать секрет). Это предусловия самой интеграции —
// используется и для ручной генерации по запросу (generateMeeting), и тумблером.
export async function canCreateMeeting(userId: string): Promise<boolean> {
  const integration = await getZoomIntegration(userId);
  if (!integration) return false;
  return Boolean(
    integration.enabled &&
      integration.accountId &&
      integration.clientId &&
      integration.clientSecretEnc &&
      isEncryptionKeySet(),
  );
}

// Можно ли АВТОМАТИЧЕСКИ создать встречу Zoom для пользователя (по глобальному
// тумблеру): технические предусловия интеграции (canCreateMeeting) И включён
// тумблер автосоздания autoCreateMeeting.
export async function shouldAutoCreate(userId: string): Promise<boolean> {
  const integration = await getZoomIntegration(userId);
  if (!integration) return false;
  return Boolean(
    integration.enabled &&
      integration.autoCreateMeeting &&
      integration.accountId &&
      integration.clientId &&
      integration.clientSecretEnc &&
      isEncryptionKeySet(),
  );
}

// ---------------------------------------------------------------------------
// Вебхуки Zoom (Фаза 3): валидация подписи, URL-валидация эндпоинта, выгрузка
// записей и AI-резюме встреч. Используются роутом вебхука и фоновой обработкой.
// ---------------------------------------------------------------------------

// Находит интеграцию Zoom по идентификатору вебхука (Zoom присылает его в payload
// эндпоинт-событий). Возвращает null, если такой интеграции нет.
export function getZoomIntegrationByWebhookId(webhookId: string) {
  return prisma.zoomIntegration.findUnique({ where: { webhookId } });
}

// Проверяет подпись вебхука Zoom (Webhook Secret Token).
// Zoom формирует message = `v0:${timestamp}:${rawBody}` и подписывает его
// HMAC-SHA256 на секрет-токене (hex), присылая в заголовке `x-zm-signature`
// значение вида `v0=<hash>`. Сравниваем timing-safe.
// При несовпадении длины буферов (или любой иной аномалии) возвращаем false,
// не бросая исключение.
export function verifyZoomSignature(
  secretToken: string,
  rawBody: string,
  timestamp: string,
  signatureHeader: string,
): boolean {
  try {
    if (!secretToken || !signatureHeader) return false;
    const message = `v0:${timestamp}:${rawBody}`;
    const hash = createHmac('sha256', secretToken).update(message).digest('hex');
    const expected = `v0=${hash}`;
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signatureHeader, 'utf8');
    // timingSafeEqual требует равной длины — иначе сразу false (но без раннего
    // выхода это и так была бы не та подпись).
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

// Формирует ответ на событие endpoint.url_validation: Zoom присылает plainToken,
// а в ответ ждёт { plainToken, encryptedToken }, где encryptedToken —
// HMAC-SHA256(secretToken, plainToken) в hex.
export function buildUrlValidationResponse(
  secretToken: string,
  plainToken: string,
): { plainToken: string; encryptedToken: string } {
  const encryptedToken = createHmac('sha256', secretToken).update(plainToken).digest('hex');
  return { plainToken, encryptedToken };
}

// Минимально необходимое описание файла записи Zoom.
export interface ZoomRecordingFile {
  download_url?: string;
  file_type?: string;
  recording_type?: string;
  file_extension?: string;
}

interface ZoomRecordingsResponse {
  recording_files?: ZoomRecordingFile[];
}

// Ошибка вызова API Zoom с СОХРАНЁННЫМ HTTP-кодом. Нужна вызывающему (обработке
// записи/транскрипта), чтобы отличить «записи ещё нет» (404 на листинге recordings
// → данные формируются) от реальной ошибки доступа (403/нет scope → сбой). Текст
// безопасен (только код, без сырого URL/тела ответа Zoom).
export class ZoomApiHttpError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `Zoom вернул ошибку (HTTP ${status})`);
    this.status = status;
  }
}

// Возвращает список файлов записи встречи Zoom.
// GET https://api.zoom.us/v2/meetings/{meetingId}/recordings (Bearer).
// Бросает ZoomApiHttpError при неуспехе (вызывающий смотрит status: 404 = записи
// ещё нет/не готова → processing; прочее, напр. 403 = реальная ошибка → failed).
export async function getMeetingRecordings(
  userId: string,
  meetingId: string,
): Promise<ZoomRecordingFile[]> {
  const token = await getZoomAccessToken(userId);

  const res = await fetch(
    `${ZOOM_API_URL}/meetings/${encodeURIComponent(meetingId)}/recordings`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { message?: string };
      detail = errBody.message || '';
    } catch {
      // тело может быть не JSON — игнорируем
    }
    throw new ZoomApiHttpError(
      res.status,
      `Zoom вернул ошибку при получении записей (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  const data = (await res.json()) as ZoomRecordingsResponse;
  return data.recording_files ?? [];
}

// Минимально необходимое описание AI-резюме встречи Zoom.
export interface ZoomMeetingSummary {
  summary_title?: string;
  summary_overview?: string;
  summary_details?: unknown;
}

// Возвращает AI-резюме встречи Zoom либо null, если оно недоступно.
// GET https://api.zoom.us/v2/meetings/{meetingId}/meeting_summary (Bearer).
// AI Companion может быть не включён → на 404/недоступность возвращаем null,
// не бросая. На прочие ошибки бросаем Error.
export async function getMeetingSummary(
  userId: string,
  meetingId: string,
): Promise<ZoomMeetingSummary | null> {
  const token = await getZoomAccessToken(userId);

  const res = await fetch(
    `${ZOOM_API_URL}/meetings/${encodeURIComponent(meetingId)}/meeting_summary`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  // Резюме может быть не включено/ещё не готово — это не ошибка интеграции.
  if (res.status === 404) return null;

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { message?: string };
      detail = errBody.message || '';
    } catch {
      // тело может быть не JSON — игнорируем
    }
    throw new Error(
      `Zoom вернул ошибку при получении резюме (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  const data = (await res.json()) as ZoomMeetingSummary;
  return data;
}
