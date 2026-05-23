import type { FastifyInstance } from 'fastify';
import { prisma, type ZoomIntegration } from '@platform/db';
import { requireRole } from '../middleware/auth.js';
import { encryptSecret, decryptSecret, isEncryptionKeySet } from '../lib/crypto.js';
import { getZoomIntegration, getZoomAccessToken } from '../lib/zoom.js';

// Безопасный публичный вид настроек Zoom: секрет НЕ отдаём.
// secretSet — есть ли сохранённый секрет; secretLast4 — последние 4 символа
// расшифрованного секрета (только если ключ шифрования есть и расшифровка удалась).
interface ZoomIntegrationPublic {
  enabled: boolean;
  autoCreateMeeting: boolean;
  accountId: string | null;
  clientId: string | null;
  secretSet: boolean;
  secretLast4: string | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  encryptionKeySet: boolean;
}

// Превращает запись (или её отсутствие) в безопасный объект для ответа.
function toPublic(integration: ZoomIntegration | null): ZoomIntegrationPublic {
  const keySet = isEncryptionKeySet();
  const enc = integration?.clientSecretEnc ?? null;
  const secretSet = Boolean(enc);

  let secretLast4: string | null = null;
  // last4 показываем только если ключ есть и секрет успешно расшифровывается.
  if (enc && keySet) {
    try {
      const plain = decryptSecret(enc);
      secretLast4 = plain.slice(-4);
    } catch {
      secretLast4 = null;
    }
  }

  return {
    enabled: integration?.enabled ?? false,
    autoCreateMeeting: integration?.autoCreateMeeting ?? false,
    accountId: integration?.accountId ?? null,
    clientId: integration?.clientId ?? null,
    secretSet,
    secretLast4,
    lastTestedAt: integration?.lastTestedAt ?? null,
    lastTestOk: integration?.lastTestOk ?? null,
    encryptionKeySet: keySet,
  };
}

export async function integrationRoutes(app: FastifyInstance) {
  // Все эндпоинты раздела — только для администраторов.
  app.addHook('preHandler', requireRole('admin'));

  // GET /admin/integrations/zoom — текущие настройки (без секрета).
  app.get('/admin/integrations/zoom', async () => {
    const integration = await getZoomIntegration();
    return toPublic(integration);
  });

  // PUT /admin/integrations/zoom — сохранить настройки (upsert синглтона).
  app.put('/admin/integrations/zoom', async (request, reply) => {
    const body = (request.body ?? {}) as {
      enabled?: boolean;
      autoCreateMeeting?: boolean;
      accountId?: string;
      clientId?: string;
      clientSecret?: string;
    };

    // Готовим поля, которые меняем. Секрет — отдельно (требует шифрования).
    const data: {
      enabled?: boolean;
      autoCreateMeeting?: boolean;
      accountId?: string | null;
      clientId?: string | null;
      clientSecretEnc?: string;
    } = {};

    if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
    if (typeof body.autoCreateMeeting === 'boolean') data.autoCreateMeeting = body.autoCreateMeeting;
    if (typeof body.accountId === 'string') data.accountId = body.accountId.trim() || null;
    if (typeof body.clientId === 'string') data.clientId = body.clientId.trim() || null;

    // clientSecret: если непустая строка — шифруем; иначе не трогаем сохранённый.
    if (typeof body.clientSecret === 'string' && body.clientSecret.length > 0) {
      if (!isEncryptionKeySet()) {
        return reply
          .status(400)
          .send({ error: 'Не настроен ключ шифрования APP_ENCRYPTION_KEY на сервере' });
      }
      try {
        data.clientSecretEnc = encryptSecret(body.clientSecret);
      } catch {
        return reply
          .status(400)
          .send({ error: 'Не настроен ключ шифрования APP_ENCRYPTION_KEY на сервере' });
      }
    }

    const integration = await prisma.zoomIntegration.upsert({
      where: { id: 'default' },
      update: data,
      create: {
        id: 'default',
        enabled: data.enabled ?? false,
        autoCreateMeeting: data.autoCreateMeeting ?? false,
        accountId: data.accountId ?? null,
        clientId: data.clientId ?? null,
        clientSecretEnc: data.clientSecretEnc ?? null,
      },
    });

    return toPublic(integration);
  });

  // POST /admin/integrations/zoom/test — проверка соединения с Zoom.
  // Любые ошибки конфигурации/ключа/Zoom -> ok:false + понятное message (НЕ 500).
  app.post('/admin/integrations/zoom/test', async () => {
    let ok = false;
    let message = '';

    try {
      if (!isEncryptionKeySet()) {
        message = 'Не настроен ключ шифрования APP_ENCRYPTION_KEY на сервере';
      } else {
        const token = await getZoomAccessToken();
        const res = await fetch('https://api.zoom.us/v2/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          ok = true;
          message = 'Соединение с Zoom успешно';
        } else {
          let detail = '';
          try {
            const errBody = (await res.json()) as { message?: string };
            detail = errBody.message || '';
          } catch {
            // тело может быть не JSON
          }
          message = `Zoom вернул ошибку (${res.status})${detail ? `: ${detail}` : ''}`;
        }
      }
    } catch (err) {
      message = err instanceof Error ? err.message : 'Не удалось проверить соединение с Zoom';
    }

    // Фиксируем результат проверки в синглтоне (если он существует).
    try {
      await prisma.zoomIntegration.update({
        where: { id: 'default' },
        data: { lastTestedAt: new Date(), lastTestOk: ok },
      });
    } catch {
      // Записи может ещё не быть (настройки не сохраняли) — это не ошибка теста.
    }

    return { ok, message };
  });
}
