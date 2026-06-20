'use client';

import { useEffect, useState } from 'react';
import { Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { updateMeeting, type Meeting } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { dateKey } from '@/components/schedule/utils';

/**
 * Лёгкий диалог переноса встречи 1-на-1 (только planned, только владелец-препод).
 *
 * Меняет дату/время через PATCH /meetings/:id — бэк best-effort пересоздаёт созвон
 * Zoom (старая ссылка перестаёт работать, студент получает новую автоматически),
 * поэтому об этом предупреждаем info-блоком. Намеренно НЕ переиспользуем тяжёлый
 * plan-event-dialog (там выбор студента/типа события) — здесь только дата и время.
 */
export function RescheduleMeetingDialog({
  meeting,
  open,
  onOpenChange,
  onRescheduled,
}: {
  meeting: Meeting;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Встреча успешно перенесена — родитель обновляет данные (как после отмены). */
  onRescheduled: (updated: Meeting) => void;
}) {
  const { accessToken } = useAuth();
  const isMobile = useIsMobile();
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Предзаполняем текущими значениями встречи при каждом открытии (и сбрасываем
  // прошлую ошибку): пользователь видит точку отсчёта, правит только нужное.
  useEffect(() => {
    if (!open) return;
    setDate(meeting.date ?? '');
    setStartTime(meeting.startTime ?? '');
    setError('');
  }, [open, meeting.date, meeting.startTime]);

  const valid = !!date && !!startTime;
  // Мягкое предупреждение: дата раньше сегодняшней (не блокирует перенос).
  const isPast = !!date && date < dateKey(new Date());

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateMeeting(accessToken, meeting.id, { date, startTime });
      onRescheduled(updated);
      onOpenChange(false);
      toast.success('Встреча перенесена');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось перенести встречу');
    } finally {
      setSaving(false);
    }
  };

  const subtitle = 'Новые дата и время. Студент получит обновлённые данные встречи.';

  const body = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="reschedule-date">Дата</FieldLabel>
          <DatePicker
            id="reschedule-date"
            value={date}
            onChange={(v) => setDate(v ?? '')}
            clearable={false}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="reschedule-time">
            Время начала<span className="text-destructive"> *</span>
          </FieldLabel>
          <Input
            id="reschedule-time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </Field>
      </div>

      {isPast && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Дата в прошлом — напоминания не уйдут.
        </p>
      )}

      {/* Перенос пересоздаёт созвон Zoom — показываем только если ссылка есть. */}
      {meeting.meetingUrl && (
        <div className="flex items-start gap-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Ссылка на созвон обновится. Старая перестанет работать — студент получит
            новую автоматически.
          </span>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Footer
        isMobile={isMobile}
        saving={saving}
        valid={valid}
        onClose={() => onOpenChange(false)}
      />
    </form>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[90vh] gap-0 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Перенести встречу</SheetTitle>
            <SheetDescription>{subtitle}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Перенести встречу</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function Footer({
  isMobile,
  saving,
  valid,
  onClose,
}: {
  isMobile: boolean;
  saving: boolean;
  valid: boolean;
  onClose: () => void;
}) {
  const content = (
    <>
      <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
        Отмена
      </Button>
      <Button type="submit" disabled={!valid || saving}>
        {saving && <Loader2 className="animate-spin" />}
        Перенести
      </Button>
    </>
  );

  return isMobile ? (
    <SheetFooter className="px-0">{content}</SheetFooter>
  ) : (
    <DialogFooter>{content}</DialogFooter>
  );
}
