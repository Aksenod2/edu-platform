'use client';

/**
 * ThemeColorMeta — синхронизирует <meta name="theme-color"> с активной темой.
 * Приложение НЕ следует системной теме, поэтому управляем мета-тегом вручную
 * по resolvedTheme из next-themes: тёмная → #0a0a0a, светлая → #ffffff.
 * Hydration-safe: всё происходит в эффекте после монтирования. Рендерит null.
 */

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const color = resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff';

    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', color);
  }, [resolvedTheme]);

  return null;
}
