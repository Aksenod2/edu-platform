'use client';

/**
 * InstallInstructions — переиспользуемая инструкция установки PWA на iPhone/iPad.
 *
 * Содержит:
 * - IosShareIcon / IosAddToHomeIcon — точные визуалы иконок из Safari (inline SVG),
 *   чтобы пользователь УЗНАЛ их в браузере (в lucide точной «Поделиться» нет).
 * - IosInstallSteps — сами шаги (текст + иконки). Используются И в автоплашке
 *   PwaInstallPrompt, И по кнопке InstallAppButton — без дублирования разметки.
 * - InstallAppButton — кнопка «Как установить приложение» для экранов настроек:
 *   видна только на iOS вне standalone (детекты из lib/push.ts), открывает Sheet
 *   с теми же шагами.
 */

import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { isIOS, isStandalonePwa } from '@/lib/push';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';

/**
 * Иконка «Поделиться» как в iOS Safari: квадрат-основание со стрелкой,
 * выходящей вверх за его пределы. Цвет наследуется (currentColor) — читаемо
 * в обеих темах.
 */
export function IosShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {/* Стрелка вверх */}
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      {/* Прямоугольник-основание (коробка), из которой «вылетает» стрелка */}
      <path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

/**
 * Иконка «На экран „Домой"» как в iOS: плюс внутри скруглённого квадрата.
 */
export function IosAddToHomeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

/**
 * Шаги установки на iOS. Один источник правды для всех мест показа.
 * Иконки выровнены по тексту и подсвечены как «бейдж», чтобы повторяли вид кнопок Safari.
 */
export function IosInstallSteps() {
  return (
    <ol className="space-y-3 text-sm text-foreground">
      <li className="flex items-start gap-2.5">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          1
        </span>
        <span className="leading-relaxed">
          Нажмите{' '}
          <span className="inline-flex items-center gap-1 align-middle rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">
            <IosShareIcon className="size-4 shrink-0" />
            Поделиться
          </span>{' '}
          — внизу экрана Safari (или в адресной строке).
        </span>
      </li>
      <li className="flex items-start gap-2.5">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          2
        </span>
        <span className="leading-relaxed">
          В появившемся меню выберите{' '}
          <span className="inline-flex items-center gap-1 align-middle rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">
            <IosAddToHomeIcon className="size-4 shrink-0" />
            На экран «Домой»
          </span>
          .
        </span>
      </li>
      <li className="flex items-start gap-2.5">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          3
        </span>
        <span className="leading-relaxed">
          Нажмите <span className="font-medium text-foreground">«Добавить»</span> — значок появится
          на главном экране.
        </span>
      </li>
    </ol>
  );
}

/**
 * Кнопка «Как установить приложение» для страниц настроек.
 * Показывается ТОЛЬКО на iOS и когда приложение НЕ запущено как standalone.
 * По клику открывает Sheet с теми же шагами (IosInstallSteps).
 */
export function InstallAppButton() {
  // Окружение определяем только на клиенте (зависит от navigator/window).
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    setEligible(isIOS() && !isStandalonePwa());
  }, []);

  if (!eligible) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          <Smartphone className="size-4" aria-hidden />
          Как установить приложение
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-w-md">
        <SheetHeader>
          <SheetTitle>Установка на iPhone и iPad</SheetTitle>
          <SheetDescription>
            Добавьте OCHOBA на главный экран — быстрый запуск в отдельном окне и push-уведомления о
            новых заданиях и ответах.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <IosInstallSteps />
        </div>
      </SheetContent>
    </Sheet>
  );
}
