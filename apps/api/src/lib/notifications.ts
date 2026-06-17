import { prisma, type NotificationType, Prisma } from '@platform/db';
import { sendNotificationEmail } from './email.js';
import { sendWebPush } from './webpush.js';
import { sendTelegramMessage } from './telegram.js';
import { decryptSecret, isEncryptionKeySet } from './crypto.js';

// Минимальный escape для HTML parse_mode Telegram: экранируем спецсимволы,
// чтобы '<', '>', '&' в title/body не ломали разметку сообщения.
function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create an in-app notification and optionally send email/push
 * based on user preferences. Fire-and-forget: errors are logged, not thrown.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    const { userId, type, title, body, metadata } = params;

    // Load user preferences for this notification type (or use defaults if none set)
    const [user, pref] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }),
      prisma.notificationPreference.findUnique({ where: { userId_type: { userId, type } } }),
    ]);

    if (!user) return;

    const inAppEnabled = pref?.inAppEnabled ?? true;
    const emailEnabled = pref?.emailEnabled ?? true;
    const pushEnabled = pref?.pushEnabled ?? true;
    const telegramEnabled = pref?.telegramEnabled ?? true;

    // Create in-app notification
    if (inAppEnabled) {
      await prisma.notification.create({
        data: {
          userId,
          type,
          title,
          body,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
          isRead: false,
        },
      });
    }

    // Send email (fire-and-forget)
    if (emailEnabled) {
      sendNotificationEmail(user.email, user.name, title, body).catch((err) => {
        console.error('[notifications] email send error', err);
      });
    }

    // Send web push (fire-and-forget)
    if (pushEnabled) {
      const subs = await prisma.pushSubscription.findMany({ where: { userId } });
      for (const sub of subs) {
        sendWebPush(sub, { title, body, data: metadata }).catch((err) => {
          console.error('[notifications] push send error', err);
        });
      }
    }

    // Send Telegram message (fire-and-forget). Канал нужен только если он включён в
    // предпочтениях И настроено шифрование (без ключа токен не расшифровать) — лишний
    // запрос за интеграцией делаем лишь при выполнении этих условий.
    if (telegramEnabled && isEncryptionKeySet()) {
      const integration = await prisma.telegramIntegration.findUnique({
        where: { userId },
        select: { botTokenEnc: true, chatId: true, enabled: true },
      });
      if (integration?.enabled && integration.botTokenEnc && integration.chatId) {
        const { botTokenEnc, chatId } = integration;
        try {
          const botToken = decryptSecret(botTokenEnc);
          const text = `<b>${escapeTelegramHtml(title)}</b>\n${escapeTelegramHtml(body)}`;
          sendTelegramMessage(botToken, chatId, text).catch((err) => {
            console.error('[notifications] telegram send error', err);
          });
        } catch (err) {
          console.error('[notifications] telegram send error', err);
        }
      }
    }
  } catch (err) {
    console.error('[notifications] createNotification error', err);
  }
}

/**
 * Fan-out: send notification to multiple users at once.
 */
export async function notifyMany(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    userIds.map((userId) => createNotification({ userId, type, title, body, metadata })),
  );
}
