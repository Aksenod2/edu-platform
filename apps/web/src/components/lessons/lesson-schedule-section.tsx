'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  getLessonSessions,
  getStreams,
  unscheduleLesson,
  updateLesson,
  type LessonSession,
  type LessonStatus,
  type Stream,
} from '@/lib/api';
import {
  LESSON_STATUS_LABELS,
  STATUS_ORDER,
  dateKey,
} from '@/components/schedule/utils';

const STATUS_VARIANT: Record<LessonStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  planned: 'default',
  done: 'outline',
  cancelled: 'destructive',
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Блок «Расписание» на странице урока: где и когда урок проводится (по потокам).
// Планирование = upsert Session потока через updateLesson({ streamId, ... }).
export function LessonScheduleSection({
  accessToken,
  lessonId,
}: {
  accessToken: string;
  lessonId: string;
}) {
  const [sessions, setSessions] = useState<LessonSession[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editStreamId, setEditStreamId] = useState<string | null>(null);
  const [removeStreamId, setRemoveStreamId] = useState<string | null>(null);

  const [streamId, setStreamId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [status, setStatus] = useState<LessonStatus>('planned');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionsRes, streamsRes] = await Promise.all([
        getLessonSessions(accessToken, lessonId),
        getStreams(accessToken),
      ]);
      setSessions(sessionsRes.sessions);
      setStreams(streamsRes.streams);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки расписания');
    } finally {
      setLoading(false);
    }
  }, [accessToken, lessonId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeStreams = streams.filter((s) => s.status === 'active');
  const scheduledIds = new Set(sessions.map((s) => s.streamId));
  const availableStreams = activeStreams.filter((s) => !scheduledIds.has(s.id));

  function openAdd() {
    setEditStreamId(null);
    setStreamId(availableStreams.length === 1 ? availableStreams[0].id : '');
    setDate(dateKey(new Date()));
    setStartTime('');
    setMeetingUrl('');
    setStatus('planned');
    setDialogOpen(true);
  }

  function openEdit(s: LessonSession) {
    setEditStreamId(s.streamId);
    setStreamId(s.streamId);
    setDate(s.date ?? '');
    setStartTime(s.startTime ?? '');
    setMeetingUrl(s.meetingUrl ?? '');
    setStatus(s.status);
    setDialogOpen(true);
  }

  const plannedWithoutDate = status === 'planned' && !date;
  const valid = !!streamId && !plannedWithoutDate;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await updateLesson(accessToken, lessonId, {
        streamId,
        date: date || null,
        startTime: startTime || null,
        status,
        meetingUrl: meetingUrl.trim() || null,
      });
      setDialogOpen(false);
      await load();
      toast.success(editStreamId ? 'Расписание обновлено' : 'Урок запланирован');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(sid: string) {
    try {
      await unscheduleLesson(accessToken, lessonId, sid);
      await load();
      toast.success('Снято с расписания');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    }
  }

  // Потоки в селекте: при редактировании — все активные (поток зафиксирован и
  // выключен), при добавлении — только ещё не запланированные.
  const selectStreams = editStreamId ? activeStreams : availableStreams;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Расписание</FieldLabel>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={openAdd}
          disabled={loading || availableStreams.length === 0}
        >
          <CalendarPlus className="size-4" />
          Запланировать
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Загрузка…</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {activeStreams.length === 0
            ? 'Нет активных потоков для планирования.'
            : 'Урок ещё не запланирован. Нажмите «Запланировать», чтобы поставить его в поток на дату.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <div
              key={s.streamId}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span className="font-medium">{s.streamName}</span>
              <Badge variant={STATUS_VARIANT[s.status]} className="font-normal">
                {LESSON_STATUS_LABELS[s.status]}
              </Badge>
              <span className="text-muted-foreground">
                {s.date ? formatDate(s.date) : 'без даты'}
                {s.startTime ? `, ${s.startTime}` : ''}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => openEdit(s)}
                >
                  <Pencil className="size-4" />
                  <span className="sr-only">Изменить</span>
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => setRemoveStreamId(s.streamId)}
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">Снять с расписания</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editStreamId ? 'Изменить занятие' : 'Запланировать урок'}</DialogTitle>
            <DialogDescription>Поставьте урок в поток на дату и время.</DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="sched-stream">Поток</FieldLabel>
              <Select value={streamId} onValueChange={setStreamId} disabled={!!editStreamId}>
                <SelectTrigger id="sched-stream" className="w-full">
                  <SelectValue placeholder="Выберите поток" />
                </SelectTrigger>
                <SelectContent>
                  {selectStreams.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="sched-date">Дата</FieldLabel>
                <Input
                  id="sched-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sched-time">Время</FieldLabel>
                <Input
                  id="sched-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="sched-status">Статус</FieldLabel>
              <Select value={status} onValueChange={(v) => setStatus(v as LessonStatus)}>
                <SelectTrigger id="sched-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {LESSON_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {plannedWithoutDate && (
                <p className="text-xs text-destructive">
                  Для статуса «Запланирован» нужно указать дату.
                </p>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="sched-url">Ссылка на созвон</FieldLabel>
              <Input
                id="sched-url"
                type="url"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://zoom.us/j/..."
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={!valid || saving}>
                {saving && <Loader2 className="animate-spin" />}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeStreamId !== null}
        onOpenChange={(o) => !o && setRemoveStreamId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять с расписания?</AlertDialogTitle>
            <AlertDialogDescription>
              Занятие урока в этом потоке будет удалено (вместе со сдачами по нему). Сам
              урок-блок останется в копилке.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (removeStreamId) handleRemove(removeStreamId);
                setRemoveStreamId(null);
              }}
            >
              Снять
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
