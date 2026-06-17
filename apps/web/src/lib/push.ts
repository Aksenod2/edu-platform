/**
 * Web Push subscription helpers.
 * Requires NEXT_PUBLIC_VAPID_PUBLIC_KEY env var for push to work.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch {
    return null;
  }
}

export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return null;
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
    });
    return subscription;
  } catch {
    return null;
  }
}

export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Push поддерживается, только если есть и Notification, и serviceWorker, и PushManager. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/** iOS (iPhone/iPad) по userAgent. iPadOS 13+ маскируется под Mac — ловим по maxTouchPoints. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Приложение запущено как standalone PWA (добавлено на домашний экран). */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export const PUSH_DENIED_KEY = 'push_permission_denied';

export type EnablePushResult = 'subscribed' | 'denied' | 'unsupported' | 'error';

/**
 * Полная цепочка включения web-push: запрос разрешения → регистрация SW →
 * подписка → сохранение на сервере. Запрос разрешения делается СИНХРОННО в
 * начале (до любого await), чтобы iOS WebKit принял его как реакцию на жест
 * пользователя — поэтому функцию нужно вызывать прямо из обработчика клика.
 *
 * Используется и кнопкой PushToggle, и автопромптом PushManager.
 */
export async function enablePush(accessToken: string): Promise<EnablePushResult> {
  if (!isPushSupported()) return 'unsupported';

  // ВАЖНО для iOS: requestPermission вызывается синхронно по жесту, до await.
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return 'error';
  }

  if (permission === 'denied') {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PUSH_DENIED_KEY, 'true');
    }
    return 'denied';
  }
  if (permission !== 'granted') return 'error';

  const registration = await registerServiceWorker();
  if (!registration) return 'error';

  const subscription = await subscribeToPush(registration);
  if (!subscription) {
    if (typeof window !== 'undefined' && Notification.permission === 'denied') {
      window.localStorage.setItem(PUSH_DENIED_KEY, 'true');
      return 'denied';
    }
    return 'error';
  }

  const raw = subscription.toJSON();
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) return 'error';

  try {
    const { savePushSubscription } = await import('./api');
    await savePushSubscription(accessToken, {
      endpoint: raw.endpoint,
      keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    });
  } catch {
    return 'error';
  }

  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(PUSH_DENIED_KEY);
  }
  return 'subscribed';
}
