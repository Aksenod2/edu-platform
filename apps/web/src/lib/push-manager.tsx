'use client';

/**
 * PushManager — невидимый компонент. Через 30 секунд после входа пытается
 * автоматически включить push. На iOS автопромпт не работает (WebKit требует
 * user gesture), поэтому там подписка идёт только через кнопку PushToggle.
 */

import { useEffect, useRef } from 'react';
import { useAuth } from './auth-context';
import {
  enablePush,
  isPushSupported,
  isIOS,
  isStandalonePwa,
  PUSH_DENIED_KEY,
} from './push';

const PUSH_PROMPT_DELAY_MS = 30_000;

export function PushManager() {
  const { user, accessToken } = useAuth();
  const prompted = useRef(false);

  useEffect(() => {
    if (!user || !accessToken) return;
    if (prompted.current) return;
    if (!isPushSupported()) return;

    // На iOS автопромпт не сработает (нужен жест) — ждём кнопку PushToggle.
    if (isIOS() && !isStandalonePwa()) return;

    if (typeof window !== 'undefined' && window.localStorage.getItem(PUSH_DENIED_KEY) === 'true') return;

    if (Notification.permission === 'denied') return;

    // Уже разрешено — подписываемся сразу (без задержки), иначе ждём 30 сек.
    if (Notification.permission === 'granted') {
      prompted.current = true;
      void enablePush(accessToken);
      return;
    }

    const timer = setTimeout(() => {
      if (prompted.current) return;
      prompted.current = true;
      void enablePush(accessToken);
    }, PUSH_PROMPT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [user, accessToken]);

  return null;
}
