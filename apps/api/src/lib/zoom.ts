import { prisma } from '@platform/db';
import { decryptSecret } from './crypto.js';

// Интеграция с Zoom через Server-to-Server OAuth.
// Конфиг хранится пер-преподаватель: одна строка ZoomIntegration на userId.

const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token';

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
