'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth-context';
import { updateLesson, type LessonStatus } from '@/lib/api';
import {
  LESSON_STATUS_LABELS,
  STATUS_BADGE_VARIANT,
  MANUAL_STATUS_ORDER,
} from '@/components/schedule/utils';
import { LivePulseDot } from '@/components/schedule/lesson-status-badge';

/**
 * Контрол смены статуса занятия (только админ — экраны и так админские).
 *
 * Бейдж текущего статуса = триггер дропдауна (ChevronDown + cursor-pointer,
 * это <button>), пункты — статусы из STATUS_ORDER (текущий помечен галочкой).
 * Рядом — заметная primary-кнопка «Провести» для частого перехода planned→done.
 *
 * Статус 'live' («Идёт») — СИСТЕМНЫЙ (ставит Zoom между meeting.started/ended),
 * поэтому вручную его не предлагаем: в меню ручных опций его нет. При status==='live'
 * бейдж-триггер рисуем «живым» (пульсирующая точка), а из 'live' разрешены ручные
 * переходы только в done/cancelled (как и откаты для прочих статусов).
 *
 * Особые случаи:
 *  - переход в 'cancelled' — через AlertDialog с предупреждением (студенты
 *    получат уведомление, встреча Zoom удалится — это делает бэкенд);
 *  - выбор 'planned' для занятия без даты — НЕ слать пустой PATCH: показываем
 *    toast и (если задан onEditRequest) предлагаем открыть редактирование.
 *
 * Смена статуса оптимистична: бейдж меняется сразу, при ошибке PATCH —
 * откатывается + toast.error. onChanged зовётся после успеха (ре-фетч родителя).
 *
 * PATCH идёт через updateLesson({ streamId, status }); без streamId статус
 * пер-поточной Session не сохранится, поэтому streamId обязателен.
 */
export function SessionStatusControl({
  lessonId,
  streamId,
  status,
  hasDate,
  onChanged,
  onEditRequest,
  size = 'sm',
  className,
}: {
  lessonId: string;
  streamId: string;
  status: LessonStatus;
  /** Есть ли у занятия дата — нужно для правила «planned требует даты». */
  hasDate: boolean;
  /** Колбэк после успешной смены статуса (ре-фетч данных родителя). */
  onChanged?: () => void;
  /** Открыть редактирование (там есть поле даты) — для «planned без даты». */
  onEditRequest?: () => void;
  /** Размер контрола: компактный для таблиц/строк, обычный — для карточек. */
  size?: 'sm' | 'default';
  className?: string;
}) {
  const { accessToken } = useAuth();
  // Оптимистичный статус: то, что видит пользователь (может опережать сервер).
  const [optimistic, setOptimistic] = useState<LessonStatus>(status);
  const [pending, setPending] = useState(false);
  // Целевой статус, ожидающий подтверждения отмены через AlertDialog.
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Внешний status — источник правды; синхронизируем, если родитель обновил.
  if (status !== optimistic && !pending) {
    setOptimistic(status);
  }

  const current = optimistic;

  // Применить статус: оптимистично + PATCH, при ошибке — откат и toast.
  async function applyStatus(next: LessonStatus) {
    if (!accessToken || pending || next === current) return;

    // «Запланирован» требует даты: не шлём пустой PATCH — подсказываем дату.
    if (next === 'planned' && !hasDate) {
      toast.error('Для статуса «Запланирован» нужна дата', {
        description: 'Укажите дату занятия в редактировании.',
        action: onEditRequest
          ? { label: 'Открыть', onClick: () => onEditRequest() }
          : undefined,
      });
      return;
    }

    const prev = current;
    setOptimistic(next);
    setPending(true);
    try {
      await updateLesson(accessToken, lessonId, { streamId, status: next });
      toast.success(next === 'done' ? 'Занятие проведено' : 'Статус изменён');
      onChanged?.();
    } catch (err) {
      setOptimistic(prev); // откат бейджа
      toast.error(err instanceof Error ? err.message : 'Не удалось изменить статус');
    } finally {
      setPending(false);
    }
  }

  // Выбор пункта меню: 'cancelled' уводим в подтверждение, остальное — сразу.
  function handleSelect(next: LessonStatus) {
    if (next === current) return;
    if (next === 'cancelled') {
      setConfirmCancel(true);
      return;
    }
    void applyStatus(next);
  }

  const badgeHeight = size === 'sm' ? 'min-h-8' : 'min-h-9';

  // 'live' — системный статус (ставит Zoom), руками его не выбирают: меню берёт
  // только ручные статусы (MANUAL_STATUS_ORDER, без 'live').
  const menuStatuses = MANUAL_STATUS_ORDER;
  const isLive = current === 'live';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={pending}>
          {/* Бейдж-триггер: <button> с увеличенной тап-зоной (≥32–36px по высоте),
              cursor-pointer и ChevronDown как аффорданс кликабельности. */}
          <Badge
            asChild
            variant={isLive ? 'default' : STATUS_BADGE_VARIANT[current]}
            className={cn(
              'cursor-pointer gap-1 px-2.5 py-1 text-sm transition-opacity hover:opacity-90 focus-visible:outline-none',
              isLive && 'font-medium',
              badgeHeight,
            )}
          >
            <button type="button" aria-label="Сменить статус занятия">
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isLive ? (
                <LivePulseDot />
              ) : null}
              {LESSON_STATUS_LABELS[current]}
              <ChevronDown className="size-3.5 opacity-70" />
            </button>
          </Badge>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuLabel>Статус занятия</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {menuStatuses.map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => handleSelect(s)}
              className={cn(
                'cursor-pointer',
                s === current && 'font-medium',
                s === 'cancelled' && 'text-destructive focus:text-destructive',
              )}
            >
              <Check
                className={cn('size-4', s === current ? 'opacity-100' : 'opacity-0')}
              />
              {LESSON_STATUS_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Частый переход planned→done: отдельная заметная primary-кнопка.
          Для занятия без даты «Провести» разрешено (в отличие от «Запланирован»).
          Для 'live' это «завершить занятие вручную» (live→done). */}
      {(current === 'planned' || current === 'live') && (
        <Button
          type="button"
          size={size === 'sm' ? 'sm' : 'default'}
          onClick={() => void applyStatus('done')}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Провести
        </Button>
      )}

      {/* Подтверждение отмены: бэк сам уведомит студентов и удалит встречу Zoom. */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить занятие?</AlertDialogTitle>
            <AlertDialogDescription>
              Студенты получат уведомление, встреча Zoom будет удалена,
              присоединиться будет нельзя.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Не отменять</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void applyStatus('cancelled')}
            >
              Отменить занятие
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
