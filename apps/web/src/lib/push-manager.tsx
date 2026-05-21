'use client';

/**
 * PushManager — регистрирует Service Worker и запрашивает разрешение на Push
 * через 30 секунд после входа пользователя. Рендерит null (невидимый компонент).
 */

import { useEffect, useRef } from 'react';
import { useAuth } from './auth-context';
import { registerServiceWorker, subscribeToPush } from './push';
import { savePushSubscription } from './api';

const PUSH_PROMPT_DELAY_MS = 30_000;
const PUSH_DENIED_KEY = 'push_permission_denied';

export function PushManager() {
  const { user, accessToken } = useAuth();
  const prompted = useRef(false);

  useEffect(() => {
    if (!user || !accessToken) return;
    if (prompted.current) return;

    // Не показываем, если уже отказался
    if (typeof window !== 'undefined' && window.localStorage.getItem(PUSH_DENIED_KEY) === 'true') return;

    // Не показываем, если браузер не поддерживает
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    // Уже разрешено/запрещено — пропускаем prompt, только регистрируем SW
    if (Notification.permission === 'granted') {
      registerAndSubscribe(accessToken);
      return;
    }
    if (Notification.permission === 'denied') return;

    // Показываем prompt через 30 сек
    const timer = setTimeout(async () => {
      if (prompted.current) return;
      prompted.current = true;
      await registerAndSubscribe(accessToken);
    }, PUSH_PROMPT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [user, accessToken]);

  return null;
}

async function registerAndSubscribe(accessToken: string) {
  const registration = await registerServiceWorker();
  if (!registration) return;

  const subscription = await subscribeToPush(registration);
  if (!subscription) {
    // Пользователь отказал — сохраняем в localStorage
    if (typeof window !== 'undefined' && Notification.permission === 'denied') {
      window.localStorage.setItem(PUSH_DENIED_KEY, 'true');
    }
    return;
  }

  // Сохраняем подписку на сервере
  const raw = subscription.toJSON();
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) return;

  try {
    await savePushSubscription(accessToken, {
      endpoint: raw.endpoint,
      keys: {
        p256dh: raw.keys.p256dh,
        auth: raw.keys.auth,
      },
    });
  } catch {
    // Тихий сбой
  }
}
