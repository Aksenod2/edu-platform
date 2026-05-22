'use client';

/**
 * ThemeProvider — инфраструктурная обёртка над next-themes.
 * Управляет классом `.dark` на корне (<html>), который переключает
 * CSS-переменные из globals.css. Это не обёртка над shadcn-компонентом,
 * а провайдер темы для всего приложения.
 */

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
