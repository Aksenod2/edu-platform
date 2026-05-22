'use client';

/**
 * ThemeToggle — кнопка переключения светлой/тёмной темы.
 * Рендерится в слоте header рядом с колокольчиком уведомлений.
 * Использует next-themes; до монтирования показывает нейтральный
 * placeholder, чтобы избежать рассинхрона при гидрации.
 */

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Переключить тему" disabled>
        <Sun className="size-5" />
      </Button>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Переключить тему"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Moon className="size-5" /> : <Sun className="size-5" />}
    </Button>
  );
}
