import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma, type ZoomIntegration } from '@platform/db';
import { requireRole } from '../middleware/auth.js';
import { encryptSecret, decryptSecret, isEncryptionKeySet } from '../lib/crypto.js';
import { getZoomIntegration, getZoomAccessToken } from '../lib/zoom.js';

// Безопасный публичный вид настроек Zoom: секреты НЕ отдаём.
// secretSet/secretTokenSet — есть ли сохранённый секрет/Secret Token;
// secretLast4/secretTokenLast4 — последние 4 символа расшифрованного значения
// (только если ключ шифрования есть и расшифровка удалась).
// webhookId — публичный неугадываемый id для персонального URL вебхука.
interface ZoomIntegrationPublic {
  enabled: boolean;
  autoCreateMeeting: boolean;
  accountId: string | null;
  clientId: string | null;
  secretSet: boolean;
  secretLast4: string | null;
  secretTokenSet: boolean;
  secretTokenLast4: string | null;
  webhookId: string | null;
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

  // Secret Token вебхука — та же схема, что у clientSecret.
  const tokenEnc = integration?.secretTokenEnc ?? null;
  const secretTokenSet = Boolean(tokenEnc);
  let secretTokenLast4: string | null = null;
  if (tokenEnc && keySet) {
    try {
      const plain = decryptSecret(tokenEnc);
      secretTokenLast4 = plain.slice(-4);
    } catch {
      secretTokenLast4 = null;
    }
  }

  return {
    enabled: integration?.enabled ?? false,
    autoCreateMeeting: integration?.autoCreateMeeting ?? false,
    accountId: integration?.accountId ?? null,
    clientId: integration?.clientId ?? null,
    secretSet,
    secretLast4,
    secretTokenSet,
    secretTokenLast4,
    webhookId: integration?.webhookId ?? null,
    lastTestedAt: integration?.lastTestedAt ?? null,
    lastTestOk: integration?.lastTestOk ?? null,
    encryptionKeySet: keySet,
  };
}

export async function integrationRoutes(app: FastifyInstance) {
  // Все эндпоинты раздела — только для администраторов.
  app.addHook('preHandler', requireRole('admin'));

  // GET /admin/integrations/zoom — настройки текущего пользователя (без секрета).
  app.get('/admin/integrations/zoom', async (request) => {
    const integration = await getZoomIntegration(request.user!.userId);
    return toPublic(integration);
  });

  // PUT /admin/integrations/zoom — сохранить настройки текущего пользователя (upsert по userId).
  app.put('/admin/integrations/zoom', async (request, reply) => {
    const body = (request.body ?? {}) as {
      enabled?: boolean;
      autoCreateMeeting?: boolean;
      accountId?: string;
      clientId?: string;
      clientSecret?: string;
      secretToken?: string;
    };

    // Готовим поля, которые меняем. Секреты — отдельно (требуют шифрования).
    const data: {
      enabled?: boolean;
      autoCreateMeeting?: boolean;
      accountId?: string | null;
      clientId?: string | null;
      clientSecretEnc?: string;
      secretTokenEnc?: string;
      webhookId?: string;
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

    // secretToken (Webhook Secret Token): та же схема, что у clientSecret.
    if (typeof body.secretToken === 'string' && body.secretToken.length > 0) {
      if (!isEncryptionKeySet()) {
        return reply
          .status(400)
          .send({ error: 'Не настроен ключ шифрования APP_ENCRYPTION_KEY на сервере' });
      }
      try {
        data.secretTokenEnc = encryptSecret(body.secretToken);
      } catch {
        return reply
          .status(400)
          .send({ error: 'Не настроен ключ шифрования APP_ENCRYPTION_KEY на сервере' });
      }
    }

    const userId = request.user!.userId;

    // webhookId — стабильный публичный id для персонального URL вебхука.
    // Генерируем один раз: при первом сохранении или если у записи его ещё нет.
    const existing = await prisma.zoomIntegration.findUnique({
      where: { userId },
      select: { webhookId: true },
    });
    if (!existing?.webhookId) {
      data.webhookId = randomUUID();
    }

    const integration = await prisma.zoomIntegration.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        enabled: data.enabled ?? false,
        autoCreateMeeting: data.autoCreateMeeting ?? false,
        accountId: data.accountId ?? null,
        clientId: data.clientId ?? null,
        clientSecretEnc: data.clientSecretEnc ?? null,
        secretTokenEnc: data.secretTokenEnc ?? null,
        webhookId: data.webhookId ?? randomUUID(),
      },
    });

    return toPublic(integration);
  });

  // POST /admin/integrations/zoom/test — проверка соединения с Zoom.
  // Любые ошибки конфигурации/ключа/Zoom -> ok:false + понятное message (НЕ 500).
  app.post('/admin/integrations/zoom/test', async (request) => {
    const userId = request.user!.userId;
    let ok = false;
    let message = '';

    try {
      if (!isEncryptionKeySet()) {
        message = 'Не настроен ключ шифрования APP_ENCRYPTION_KEY на сервере';
      } else {
        const token = await getZoomAccessToken(userId);
        const res = await fetch('https://api.zoom.us/v2/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          ok = true;
          message = 'Соединение с Zoom успешно';
          // Захватываем идентичность хоста сразу при проверке подключения: для
          // S2S OAuth `me` — это владелец, под которым создаются встречи. Нужно,
          // чтобы исключить хоста из «гостей» посещаемости. Best-effort: ошибка
          // парсинга/сохранения не должна валить тест.
          try {
            const me = (await res.json()) as { id?: string; email?: string };
            const hostEmail = me.email && me.email.trim() ? me.email.trim() : null;
            const hostZoomUserId = me.id && me.id.trim() ? me.id.trim() : null;
            if (hostEmail || hostZoomUserId) {
              await prisma.zoomIntegration.update({
                where: { userId },
                data: { hostEmail, hostZoomUserId },
              });
            }
          } catch {
            // Тело может быть не JSON либо записи ещё нет — не ошибка теста.
          }
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

    // Фиксируем результат проверки в конфиге пользователя (если он существует).
    try {
      await prisma.zoomIntegration.update({
        where: { userId },
        data: { lastTestedAt: new Date(), lastTestOk: ok },
      });
    } catch {
      // Записи может ещё не быть (настройки не сохраняли) — это не ошибка теста.
    }

    return { ok, message };
  });
}
