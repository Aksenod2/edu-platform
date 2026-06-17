import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma, type TelegramIntegration } from '@platform/db';
import { requireRole } from '../middleware/auth.js';
import { encryptSecret, decryptSecret, isEncryptionKeySet } from '../lib/crypto.js';
import { getBotInfo, fetchChatIdFromUpdates, sendTelegramMessage } from '../lib/telegram.js';

// Безопасный публичный вид настроек Telegram: сам токен и chatId НАРУЖУ не отдаём,
// только флаги наличия/состояния.
//   tokenSet  — сохранён ли токен бота (есть botTokenEnc);
//   connected — привязан ли личный чат (есть chatId);
//   encryptionKeySet — настроен ли ключ шифрования на сервере.
interface TelegramIntegrationPublic {
  tokenSet: boolean;
  botUsername: string | null;
  connected: boolean;
  enabled: boolean;
  linkedAt: string | null;
  encryptionKeySet: boolean;
}

function toPublic(integration: TelegramIntegration | null): TelegramIntegrationPublic {
  return {
    tokenSet: Boolean(integration?.botTokenEnc),
    botUsername: integration?.botUsername ?? null,
    connected: Boolean(integration?.chatId),
    // Модель по умолчанию enabled=true; для отсутствующей записи считаем true,
    // чтобы после сохранения токена канал был включён без лишнего PATCH.
    enabled: integration?.enabled ?? true,
    linkedAt: integration?.linkedAt ? integration.linkedAt.toISOString() : null,
    encryptionKeySet: isEncryptionKeySet(),
  };
}

export async function telegramIntegrationRoutes(app: FastifyInstance) {
  // Локальный rate-limit на этот скоуп: чувствительные роуты (PUT /token, POST /link,
  // POST /test) дёргают внешний Telegram API. Глобальный лимит отключён (server.ts
  // global:false), поэтому регистрируем @fastify/rate-limit здесь и навешиваем
  // per-route config.rateLimit точечно (global:false → лимитируются только роуты с
  // config.rateLimit). Ключ — по userId, если он уже проставлен к моменту счёта, иначе
  // по IP (rate-limit считает на onRequest, до preHandler-аутентификации, поэтому
  // фактически ключ — IP; для admin-only раздела этого достаточно). По образцу
  // streams-public/legal-public.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.user?.userId ?? request.ip,
  });

  // Весь раздел — только администраторам (преподаватели).
  app.addHook('preHandler', requireRole('admin'));

  // GET /admin/integrations/telegram — текущее состояние (без секретов).
  app.get('/admin/integrations/telegram', async (request) => {
    const integration = await prisma.telegramIntegration.findUnique({
      where: { userId: request.user!.userId },
    });
    return toPublic(integration);
  });

  // PUT /admin/integrations/telegram/token — сохранить токен бота (валидируем через getMe).
  app.put(
    '/admin/integrations/telegram/token',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const body = (request.body ?? {}) as { botToken?: unknown };
    const botToken = typeof body.botToken === 'string' ? body.botToken.trim() : '';
    if (!botToken) {
      return reply.status(400).send({ error: 'Не указан токен бота' });
    }

    if (!isEncryptionKeySet()) {
      return reply.status(400).send({ error: 'Не настроен ключ шифрования' });
    }

    // Валидируем токен у Telegram и заодно получаем @username бота.
    const info = await getBotInfo(botToken);
    if (!info) {
      return reply.status(400).send({ error: 'Неверный токен бота' });
    }

    const userId = request.user!.userId;
    const botTokenEnc = encryptSecret(botToken);

    // При смене токена сбрасываем привязку: chatId/linkedAt относились к ПРЕЖНЕМУ
    // боту и для нового недействительны (chat.id у каждого бота свой).
    const integration = await prisma.telegramIntegration.upsert({
      where: { userId },
      update: {
        botTokenEnc,
        botUsername: info.username,
        chatId: null,
        linkedAt: null,
      },
      create: {
        userId,
        botTokenEnc,
        botUsername: info.username,
      },
    });

    return toPublic(integration);
    },
  );

  // POST /admin/integrations/telegram/link — разовая привязка личного чата.
  app.post(
    '/admin/integrations/telegram/link',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const userId = request.user!.userId;
    const integration = await prisma.telegramIntegration.findUnique({ where: { userId } });

    if (!integration?.botTokenEnc) {
      return reply.status(400).send({ error: 'Сначала сохраните токен' });
    }
    if (!isEncryptionKeySet()) {
      return reply.status(400).send({ error: 'Не настроен ключ шифрования' });
    }

    const botToken = decryptSecret(integration.botTokenEnc);
    const chatId = await fetchChatIdFromUpdates(botToken);
    if (!chatId) {
      return reply
        .status(409)
        .send({ error: 'Не нашли сообщений боту. Откройте бота, нажмите Старт и повторите.' });
    }

    const updated = await prisma.telegramIntegration.update({
      where: { userId },
      data: { chatId, linkedAt: new Date() },
    });

    return toPublic(updated);
    },
  );

  // POST /admin/integrations/telegram/test — отправить тестовое уведомление.
  app.post(
    '/admin/integrations/telegram/test',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const userId = request.user!.userId;
    const integration = await prisma.telegramIntegration.findUnique({ where: { userId } });

    if (!integration?.botTokenEnc) {
      return reply.status(400).send({ error: 'Сначала сохраните токен' });
    }
    if (!integration.chatId) {
      return reply.status(400).send({ error: 'Чат не привязан' });
    }
    if (!isEncryptionKeySet()) {
      return reply.status(400).send({ error: 'Не настроен ключ шифрования' });
    }

    const botToken = decryptSecret(integration.botTokenEnc);
    const ok = await sendTelegramMessage(
      botToken,
      integration.chatId,
      '✅ Тестовое уведомление с платформы',
    );
    return { ok };
    },
  );

  // PATCH /admin/integrations/telegram — включить/выключить канал.
  app.patch('/admin/integrations/telegram', async (request, reply) => {
    const body = (request.body ?? {}) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return reply.status(400).send({ error: 'Поле enabled должно быть boolean' });
    }

    const userId = request.user!.userId;
    const integration = await prisma.telegramIntegration.upsert({
      where: { userId },
      update: { enabled: body.enabled },
      create: { userId, enabled: body.enabled },
    });

    return toPublic(integration);
  });

  // DELETE /admin/integrations/telegram — полностью отвязать (токен/чат сбрасываем,
  // флаг enabled оставляем как есть).
  app.delete('/admin/integrations/telegram', async (request) => {
    const userId = request.user!.userId;
    await prisma.telegramIntegration.updateMany({
      where: { userId },
      data: {
        botTokenEnc: null,
        botUsername: null,
        chatId: null,
        linkedAt: null,
      },
    });
    return { ok: true };
  });
}
