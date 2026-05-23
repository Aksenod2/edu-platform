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
  join_url?: string;
}

// Создаёт встречу Zoom под аккаунтом пользователя (S2S-приложение на его аккаунте,
// поэтому POST /users/me/meetings создаёт именно на его аккаунте).
// type: 2 — встреча с фиксированным временем (есть startTime), иначе 1 — мгновенная.
// startTime — ISO без зоны ('YYYY-MM-DDTHH:MM:00'), интерпретируется в timezone.
// Бросает Error при неуспехе — вызывающий оборачивает в try/catch и не падает.
export async function createZoomMeeting(
  userId: string,
  params: { topic: string; startTime: string | null; durationMinutes?: number },
): Promise<{ joinUrl: string }> {
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
  return { joinUrl: data.join_url };
}

// Можно ли автоматически создать встречу Zoom для пользователя:
// интеграция включена, включено автосоздание, заполнены все реквизиты и
// настроен ключ шифрования (без него не расшифровать секрет).
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
