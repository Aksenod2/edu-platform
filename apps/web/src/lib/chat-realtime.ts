'use client';

import { useEffect, useRef } from 'react';

/** Лента считается «прижатой к низу», если до конца меньше порога (px). */
export function isNearBottom(el: HTMLElement, threshold = 120) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

/**
 * Слить серверную ленту с локально добавленными записями, которых ещё нет в
 * ответе (например, только что отправленное сообщение, пока поллинг был в пути).
 * Серверные данные — основа; локальные «хвосты» дописываются в конец.
 */
export function mergeById<T extends { id: string }>(server: T[], prev: T[]): T[] {
  if (prev.length === 0) return server;
  const serverIds = new Set(server.map((e) => e.id));
  const localOnly = prev.filter((e) => !serverIds.has(e.id));
  return localOnly.length ? [...server, ...localOnly] : server;
}

/**
 * Периодически вызывает callback (поллинг ленты чата). Пауза, когда вкладка
 * скрыта; при возврате на вкладку или фокусе окна — немедленный вызов и
 * возобновление интервала.
 */
export function usePolling(callback: () => void, intervalMs: number, enabled = true) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) {
        timer = setInterval(() => {
          if (!document.hidden) saved.current();
        }, intervalMs);
      }
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        saved.current();
        start();
      }
    };
    const onFocus = () => saved.current();

    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [intervalMs, enabled]);
}
