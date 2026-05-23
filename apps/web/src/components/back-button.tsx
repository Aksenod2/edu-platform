'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@platform/ui/lib/utils';

/**
 * Возврат на предыдущую страницу с уважением реальной истории навигации.
 *
 * Если история есть (пользователь пришёл переходом внутри приложения) — делаем
 * router.back(), чтобы вернуться именно туда, откуда зашли. Если истории нет
 * (прямой заход по ссылке, новая вкладка, переход извне) — ведём на fallbackHref
 * (разумный родительский список). Проверка истории — через window.history.length
 * с guard на SSR (на сервере window недоступен).
 */
export function useBack(fallbackHref: string) {
  const router = useRouter();

  return React.useCallback(() => {
    // SSR-guard + признак «пришли откуда-то внутри истории»: при прямом заходе
    // в истории единственная запись (length <= 1) → идём на фолбэк.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [router, fallbackHref]);
}

type BackButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'asChild' | 'onClick'
> & {
  /** Куда вести, если реальной истории нет (прямой заход/переход извне). */
  fallbackHref: string;
  /** Иконка слева. По умолчанию ArrowLeft. */
  icon?: React.ReactNode;
};

/**
 * Кнопка «Назад» на основе shadcn/ui Button. По умолчанию выглядит как
 * текстовая ghost-кнопка с иконкой ArrowLeft. Текст задаётся через children.
 */
export function BackButton({
  fallbackHref,
  icon = <ArrowLeft />,
  variant = 'ghost',
  size = 'sm',
  className,
  children = 'Назад',
  ...props
}: BackButtonProps) {
  const goBack = useBack(fallbackHref);

  return (
    <Button
      variant={variant}
      size={size}
      className={cn('-ml-2 w-fit', className)}
      onClick={goBack}
      {...props}
    >
      {icon}
      {children}
    </Button>
  );
}
