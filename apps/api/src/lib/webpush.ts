import webpush from 'web-push';
import { prisma } from '@platform/db';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@platform.local';

  if (!publicKey || !privateKey) {
    console.warn('[webpush] VAPID keys not set — web push disabled');
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPush(
  sub: PushSubscriptionRecord,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  ensureInit();
  if (!initialized) {
    // Видно, что push пытались отправить, но канал выключен (VAPID не сконфигурирован)
    console.warn('[webpush] skip: VAPID not configured');
    return;
  }

  const pushSub = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  // Короткий хвост endpoint для логов (без утечки полного токена); фолбэк — id подписки
  const endpointTail = sub.endpoint ? sub.endpoint.slice(-12) : sub.id;

  try {
    await webpush.sendNotification(pushSub, JSON.stringify(payload));
    console.info('[webpush] sent', { endpoint: endpointTail });
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err
        ? (err as { statusCode: number }).statusCode
        : undefined;
    // 410 Gone = subscription is no longer valid — delete it
    if (statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    } else {
      // Логируем факт ошибки отправки без payload/ключей
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[webpush] send error', { endpoint: endpointTail, status: statusCode, message });
      throw err;
    }
  }
}

export function getVapidPublicKey(): string | undefined {
  return process.env.VAPID_PUBLIC_KEY;
}
