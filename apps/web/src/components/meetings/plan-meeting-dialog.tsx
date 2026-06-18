'use client';

import { useEffect, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { createMeeting, type Meeting } from '@/lib/api';
import { dateKey } from '@/components/schedule/utils';

/**
 * Диалог «Запланировать встречу 1-на-1».
 *
 * Студент предвыбран (studentId/studentName приходят с карточки студента).
 * Поля: дата (обяз.), время (опц.), тема (опц.). Бэк сам best-effort создаёт
 * Zoom-встречу — отдельного тумблера генерации тут нет. По успеху вызываем
 * onCreated(встреча) и закрываем диалог.
 */
export function PlanMeetingDialog({
  accessToken,
  studentId,
  studentName,
  onCreated,
  triggerVariant = 'default',
  triggerClassName,
}: {
  accessToken: string;
  studentId: string;
  studentName: string;
  onCreated?: (meeting: Meeting) => void | Promise<void>;
  triggerVariant?: 'default' | 'outline' | 'secondary';
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(dateKey(new Date()));
  const [startTime, setStartTime] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Сброс полей при каждом открытии.
  useEffect(() => {
    if (!open) return;
    setDate(dateKey(new Date()));
    setStartTime('');
    setTitle('');
    setError('');
  }, [open]);

  const valid = !!date;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const meeting = await createMeeting(accessToken, {
        studentId,
        date,
        startTime: startTime || null,
        title: title.trim() || null,
      });
      await onCreated?.(meeting);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось запланировать встречу');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className={cn(triggerClassName)}>
          <CalendarPlus />
          Запланировать встречу
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Запланировать встречу</DialogTitle>
          <DialogDescription>
            Личная встреча 1-на-1 со студентом{' '}
            <span className="font-medium text-foreground">{studentName}</span>. Если
            подключён Zoom, ссылка на созвон создастся автоматически.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="meeting-date">Дата</FieldLabel>
              <DatePicker id="meeting-date" value={date} onChange={(v) => setDate(v ?? '')} />
            </Field>
            <Field>
              <FieldLabel htmlFor="meeting-time">Время начала</FieldLabel>
              <Input
                id="meeting-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="meeting-title">Тема (необязательно)</FieldLabel>
            <Input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, разбор портфолио"
              maxLength={500}
            />
          </Field>

          {!date && (
            <p className="text-xs text-destructive">Укажите дату встречи.</p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="animate-spin" />}
              Запланировать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
