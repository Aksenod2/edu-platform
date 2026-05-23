'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// Глобальный ключ-«рубильник» всех подсказок. Значение '1' = подсказки выключены
// целиком (тумблер в профиле). Отдельные подсказки скрываются по своему storageKey.
const HINTS_DISABLED_KEY = 'eduhint:disabled';

// Безопасное чтение localStorage: в приватном режиме обращение может бросить
// исключение — тогда считаем, что значение не задано (подсказка показывается).
function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Безопасная запись localStorage (приватный режим не должен ронять интерфейс).
function writeFlag(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Игнорируем: подсказка просто не «запомнит» скрытие в этой сессии.
  }
}

/**
 * Контекстная сворачиваемая подсказка для учителя/админа.
 *
 * Рендерится ТОЛЬКО после монтирования (localStorage читаем в useEffect), чтобы
 * не было рассинхронизации гидрации в Next.js. Показывается, если глобальный
 * рубильник не выключен И конкретная подсказка ещё не скрыта.
 */
export function HintCallout({
  storageKey,
  title,
  children,
}: {
  storageKey: string;
  title: string;
  children: ReactNode;
}) {
  // false до монтирования → ничего не рисуем (нет мигания/ошибки гидрации).
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const disabledAll = readFlag(HINTS_DISABLED_KEY) === '1';
    const hidden = readFlag(storageKey) === '1';
    setVisible(!disabledAll && !hidden);
  }, [storageKey]);

  // Скрыть конкретную подсказку: запоминаем в localStorage и убираем из DOM.
  const handleDismiss = () => {
    writeFlag(storageKey, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Card
      role="note"
      // Card по умолчанию flex-col gap-6 — для подсказки нужен компактный блок:
      // переопределяем отступы/тень и кладём внутрь горизонтальный контейнер.
      className="relative gap-0 border-border/60 bg-muted/50 px-4 py-3 shadow-none"
    >
      {/* Запас справа (pr-12) под кнопку-крестик, чтобы текст не залезал под неё. */}
      <div className="flex items-start gap-3 pr-8">
        <Lightbulb className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{children}</p>
          <p className="text-xs text-muted-foreground/80">
            Скрыть — можно вернуть в профиле.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Скрыть подсказку"
        onClick={handleDismiss}
        // ~40px тап-цель на мобилке; крестик прижат к верхнему правому углу.
        className="absolute right-1.5 top-1.5 size-10 text-muted-foreground sm:size-9"
      >
        <X className="size-4" />
      </Button>
    </Card>
  );
}
