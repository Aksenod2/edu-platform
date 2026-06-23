'use client';

import { useState } from 'react';
import { CalendarClock, Check, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
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
import {
  LESSON_STATUS_LABELS,
  type LessonStatus,
  type Meeting,
} from '@/lib/api';
import { LivePulseDot } from '@/components/schedule/lesson-status-badge';
import { RescheduleMeetingDialog } from '@/components/meetings/reschedule-meeting-dialog';

/**
 * Контрол смены статуса встречи 1-на-1 (только админ-преподаватель).
 *
 * Полное зеркало SessionStatusControl у занятия — чтобы «функции выглядели
 * одинаково»: бейдж текущего статуса = триггер дропдауна (ChevronDown как
 * аффорданс кликабельности), а частый переход «Провести» вынесен заметной
 * primary-кнопкой рядом. Так в блоке действий ровно ОДНА primary-кнопка, без
 * двух конкурирующих чёрных.
 *
 * Отличия от занятия (продиктованы доменом встречи, см. meetings.ts):
 *  - нет статуса draft (встречу не «ведут» как урок-блок) и нет ручного отката —
 *    переходы терминальны (done/cancelled необратимы);
 *  - 'live' для встречи можно поставить ВРУЧНУЮ («Начать», planned→live), в
 *    отличие от занятия, где live ставит только Zoom. Поэтому пункт «Начать»
 *    предлагаем в меню для запланированной встречи;
 *  - отмена встречи удаляет связанный созвон Zoom (бэк, PATCH /cancel) — об этом
 *    предупреждаем в AlertDialog.
 *
 * Доступные переходы (зеркало MEETING_STATUS_TRANSITIONS на бэке):
 *  - planned → live (Начать) | done (Провести) | cancelled (Отменить);
 *  - live    → done (Провести) | cancelled (Отменить);
 *  - done / cancelled — терминальны, контрол не показывается.
 *
 * Колбэки родителя сохранены без изменений: onStatus(next) меняет planned→live /
 * planned|live→done, onCancel — отмена (через отдельный API, с удалением созвона).
 */
export function MeetingStatusControl({
  meeting,
  pending,
  onStatus,
  onCancel,
  onRescheduled,
  className,
}: {
  /** Встреча целиком — нужна для переноса (диалог) и текстов про созвон. */
  meeting: Meeting;
  /** Идёт запрос смены статуса/отмены — блокируем контрол и крутим спиннер. */
  pending: boolean;
  /** Сменить статус: live (Начать) или done (Провести). */
  onStatus: (next: 'live' | 'done') => void;
  /** Отменить встречу (бэк удалит связанный созвон Zoom). */
  onCancel: () => void | Promise<void>;
  /** Встреча перенесена — родитель обновляет данные (как после отмены). */
  onRescheduled: (updated: Meeting) => void;
  className?: string;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reschedule, setReschedule] = useState(false);

  const status = meeting.status;

  // done/cancelled — терминальны: менять нечего, контрол не нужен.
  if (status !== 'planned' && status !== 'live') return null;

  const isLive = status === 'live';
  const current = status as LessonStatus;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={pending}>
          {/* Бейдж-триггер: <button> с увеличенной тап-зоной, cursor-pointer и
              ChevronDown как аффорданс кликабельности (зеркало занятия).
              Для planned НЕ используем глобальный STATUS_BADGE_VARIANT.planned
              ('default'/чёрный): здесь рядом стоит чёрная primary-кнопка
              «Провести», поэтому планируемый статус красим НЕЙТРАЛЬНО ('secondary')
              ЛОКАЛЬНО — единственной чёрной остаётся «Провести». Глобальный токен
              для занятий/расписания не трогаем. */}
          <Badge
            asChild
            variant={isLive ? 'default' : 'secondary'}
            className={cn(
              'min-h-9 cursor-pointer gap-1 px-2.5 py-1 text-sm transition-opacity hover:opacity-90 focus-visible:outline-none',
              isLive && 'font-medium',
            )}
          >
            <button type="button" aria-label="Сменить статус встречи">
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
          <DropdownMenuLabel>Статус встречи</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* «Начать» (planned→live) — только пока встреча запланирована.
              «Провести» в меню НЕ дублируем — этот частый переход вынесен
              отдельной primary-кнопкой рядом. В меню остаются «Начать»
              (для planned) и «Отменить встречу». */}
          {status === 'planned' && (
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => onStatus('live')}
            >
              <Check className="size-4 opacity-0" />
              Начать
            </DropdownMenuItem>
          )}
          {/* Перенос — только пока встреча запланирована (live/done/cancelled
              переносить нельзя). Диалог открываем ПОСЛЕ закрытия меню (как с
              отменой) — иначе конфликт фокуса/портала. «Провести» в меню НЕ
              дублируем (вынесена primary-кнопкой, #177). */}
          {status === 'planned' && (
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => setReschedule(true)}
            >
              <CalendarClock className="size-4" />
              Перенести…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {/* Отмена — destructive-пункт, через подтверждение (удалит созвон Zoom). */}
          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:text-destructive"
            onSelect={() => setConfirmCancel(true)}
          >
            <Check className="size-4 opacity-0" />
            Отменить встречу
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Частый переход planned|live→done: заметная primary-кнопка (зеркало
          «Провести» у занятия). Единственная primary-кнопка в блоке действий. */}
      <Button
        type="button"
        onClick={() => onStatus('done')}
        disabled={pending}
        className="min-h-9"
      >
        {pending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Провести
      </Button>

      {/* Подтверждение отмены: бэк сам удалит созвон Zoom и пометит cancelled. */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить встречу?</AlertDialogTitle>
            <AlertDialogDescription>
              Встреча будет отменена
              {meeting.meetingUrl ? ', ссылка на созвон удалится' : ''}. Студент
              получит уведомление об отмене. Это действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Не отменять</AlertDialogCancel>
            {/* Не закрываем диалог сразу (без onSelect-автозакрытия): крутим
                спиннер до ответа бэка, затем закрываем в ЛЮБОМ исходе. При успехе
                контрол и так размонтируется (встреча станет cancelled); при ошибке
                закрываем сами — ошибка показана тостом, не зависаем открытыми. */}
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={async (e) => {
                e.preventDefault();
                await onCancel();
                setConfirmCancel(false);
              }}
            >
              {pending && <Loader2 className="animate-spin" />}
              Отменить встречу
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Перенос встречи (только planned). Открывается из пункта меню. */}
      <RescheduleMeetingDialog
        meeting={meeting}
        open={reschedule}
        onOpenChange={setReschedule}
        onRescheduled={onRescheduled}
      />
    </div>
  );
}
