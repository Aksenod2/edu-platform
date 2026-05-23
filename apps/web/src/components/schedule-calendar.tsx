'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LESSON_STATUS_LABELS, type Lesson, type LessonStatus, type Stream } from '@/lib/api';
import {
  parseLocalDate,
  dateKey,
  isSameDay,
  lessonKey,
  canJoinMeeting,
  STATUS_BADGE_VARIANT,
  STATUS_ORDER,
  WEEKDAYS_SHORT,
} from '@/components/schedule/utils';

/** Урок для отображения в календаре (с опциональным именем потока). */
export type CalendarLesson = Lesson & { streamName?: string };

/** Данные для создания урока из календаря. */
export interface CalendarCreateData {
  streamId: string;
  title: string;
  date: string;
  startTime: string | null;
  status: LessonStatus;
  meetingUrl: string | null;
  notes: string | null;
}

/** Поля для обновления урока из календаря. */
export interface CalendarUpdateData {
  title?: string;
  date?: string | null;
  startTime?: string | null;
  status?: LessonStatus;
  meetingUrl?: string | null;
  notes?: string | null;
}

export interface ScheduleCalendarProps {
  /** Уроки. На календаре рисуются только те, у кого есть `date`. */
  lessons: CalendarLesson[];
  editable?: boolean;
  /** Потоки — нужны при создании урока (выбор потока). */
  streams?: Stream[];
  /** Базовый путь страницы урока — зависит от роли (студент vs админ). */
  lessonBasePath?: string;
  onCreate?: (data: CalendarCreateData) => Promise<void> | void;
  onUpdate?: (id: string, data: CalendarUpdateData) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export function ScheduleCalendar({
  lessons,
  editable = false,
  streams = [],
  lessonBasePath = '/admin/lessons',
  onCreate,
  onUpdate,
  onDelete,
}: ScheduleCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Группировка уроков по дню "YYYY-MM-DD" — только те, у кого есть date.
  const lessonsByDay = useMemo(() => {
    const map = new Map<string, CalendarLesson[]>();
    for (const lesson of lessons) {
      if (!lesson.date) continue;
      const key = dateKey(parseLocalDate(lesson.date));
      const list = map.get(key);
      if (list) list.push(lesson);
      else map.set(key, [lesson]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    }
    return map;
  }, [lessons]);

  // 6×7 сетка дней (понедельник — первый), включая дни соседних месяцев
  const cells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    // getDay(): 0=вс..6=сб -> в понедельник-первый формате 0=пн..6=вс
    const offset = (firstOfMonth.getDay() + 6) % 7;
    const start = new Date(viewYear, viewMonth, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return d;
    });
  }, [viewYear, viewMonth]);

  const goPrev = () => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  };

  const goNext = () => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  };

  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const selectedLessons = selectedKey ? lessonsByDay.get(selectedKey) ?? [] : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка: месяц/год + навигация */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {MONTHS[viewMonth]} {viewYear}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Сегодня
          </Button>
          <Button variant="outline" size="icon" onClick={goPrev} aria-label="Предыдущий месяц">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" onClick={goNext} aria-label="Следующий месяц">
            <ChevronRight />
          </Button>
        </div>
      </div>

      {/* Сетка */}
      <div className="overflow-hidden rounded-lg border bg-card">
        {/* Заголовки дней недели */}
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {WEEKDAYS_SHORT.map((w) => (
            <div
              key={w}
              className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Дни */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const key = dateKey(day);
            const dayLessons = lessonsByDay.get(key) ?? [];
            const inMonth = day.getMonth() === viewMonth;
            const isToday = isSameDay(day, today);
            const visible = dayLessons.slice(0, 3);
            const extra = dayLessons.length - visible.length;

            return (
              <button
                type="button"
                key={key + i}
                onClick={() => setSelectedKey(key)}
                className={cn(
                  'flex min-h-[96px] flex-col gap-1 border-b border-r p-1.5 text-left align-top transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  // правый край и нижний ряд без двойной рамки
                  (i + 1) % 7 === 0 && 'border-r-0',
                  i >= 35 && 'border-b-0',
                  !inMonth && 'bg-muted/20',
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs',
                    !inMonth && 'text-muted-foreground opacity-60',
                    isToday && 'bg-accent font-semibold text-accent-foreground',
                  )}
                >
                  {day.getDate()}
                </span>

                <div className="flex flex-col gap-1">
                  {visible.map((lesson) => (
                    <span
                      key={lessonKey(lesson)}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedKey(key);
                      }}
                      className={cn(
                        'flex flex-col rounded-sm bg-secondary px-1.5 py-1 text-left text-secondary-foreground',
                        lesson.status === 'cancelled' && 'opacity-50',
                      )}
                    >
                      <span
                        className={cn(
                          'truncate text-xs font-medium leading-tight',
                          lesson.status === 'cancelled' && 'line-through',
                        )}
                      >
                        {lesson.title}
                      </span>
                      <span className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                        {lesson.streamName && (
                          <span className="truncate">{lesson.streamName}</span>
                        )}
                        {lesson.startTime && (
                          <span className="shrink-0 font-mono">{lesson.startTime}</span>
                        )}
                      </span>
                    </span>
                  ))}
                  {extra > 0 && (
                    <span
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedKey(key);
                      }}
                      className="px-1 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      +{extra} ещё
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Детали дня */}
      <Sheet open={selectedKey !== null} onOpenChange={(o) => !o && setSelectedKey(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          {selectedKey && (
            <DayDetail
              dayKey={selectedKey}
              lessons={selectedLessons}
              editable={editable}
              streams={streams}
              lessonBasePath={lessonBasePath}
              onCreate={onCreate}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function formatDayTitle(dayKey: string): string {
  const d = parseLocalDate(dayKey);
  return d.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

interface DayDetailProps {
  dayKey: string;
  lessons: CalendarLesson[];
  editable: boolean;
  streams: Stream[];
  lessonBasePath: string;
  onCreate?: (data: CalendarCreateData) => Promise<void> | void;
  onUpdate?: (id: string, data: CalendarUpdateData) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
}

function DayDetail({
  dayKey,
  lessons,
  editable,
  streams,
  lessonBasePath,
  onCreate,
  onUpdate,
  onDelete,
}: DayDetailProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="capitalize">{formatDayTitle(dayKey)}</SheetTitle>
        <SheetDescription>
          {lessons.length > 0
            ? `Уроков: ${lessons.length}`
            : 'На этот день уроков нет'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-3 px-4 pb-4">
        {lessons.map((lesson) =>
          editable && editingId === lesson.id ? (
            <EditForm
              key={lessonKey(lesson)}
              lesson={lesson}
              onCancel={() => setEditingId(null)}
              onUpdate={onUpdate}
              onSaved={() => setEditingId(null)}
            />
          ) : (
            <div
              key={lessonKey(lesson)}
              className={cn(
                'rounded-lg border bg-card p-3',
                lesson.status === 'cancelled' && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <p
                    className={cn(
                      'font-medium leading-tight',
                      lesson.status === 'cancelled' && 'line-through',
                    )}
                  >
                    {lesson.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_BADGE_VARIANT[lesson.status]} className="w-fit">
                      {LESSON_STATUS_LABELS[lesson.status]}
                    </Badge>
                    {lesson.streamName && (
                      <Badge variant="secondary" className="w-fit">
                        {lesson.streamName}
                      </Badge>
                    )}
                  </div>
                </div>
                {lesson.startTime && (
                  <span className="shrink-0 font-mono text-sm text-muted-foreground">
                    {lesson.startTime}
                  </span>
                )}
              </div>
              {lesson.notes && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {lesson.notes}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {canJoinMeeting(lesson) && (
                  <a
                    href={lesson.meetingUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="no-underline"
                  >
                    <Button size="sm">Присоединиться</Button>
                  </a>
                )}
                <Button asChild size="sm" variant="outline">
                  <Link href={`${lessonBasePath}/${lesson.id}`}>
                    <ExternalLink />
                    Открыть урок
                  </Link>
                </Button>
              </div>
              {editable && (
                <>
                  <Separator className="my-3" />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingId(lesson.id)}
                    >
                      Редактировать
                    </Button>
                    <DeleteButton id={lesson.id} onDelete={onDelete} />
                  </div>
                </>
              )}
            </div>
          ),
        )}

        {editable && (
          <div>
            {showCreate ? (
              <CreateForm
                defaultDate={dayKey}
                streams={streams}
                onCreate={onCreate}
                onCancel={() => setShowCreate(false)}
                onCreated={() => setShowCreate(false)}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowCreate(true)}
              >
                Добавить урок
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function DeleteButton({
  id,
  onDelete,
}: {
  id: string;
  onDelete?: (id: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const handleConfirm = async () => {
    if (!onDelete) return;
    // Закрываем диалог ДО удаления: после удаления строка (вместе с этим
    // компонентом и диалогом) размонтируется, и Radix может не снять
    // pointer-events с body, заморозив страницу.
    setOpen(false);
    setBusy(true);
    try {
      await onDelete(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Снять с расписания
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Снять с расписания?</AlertDialogTitle>
          <AlertDialogDescription>
            Снять занятие с расписания этой группы? Урок-шаблон и его материалы
            сохранятся.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
          >
            Снять с расписания
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface EditFormProps {
  lesson: CalendarLesson;
  onCancel: () => void;
  onSaved: () => void;
  onUpdate?: (id: string, data: CalendarUpdateData) => Promise<void> | void;
}

function EditForm({ lesson, onCancel, onSaved, onUpdate }: EditFormProps) {
  const [title, setTitle] = useState(lesson.title);
  const [date, setDate] = useState(lesson.date ? lesson.date.slice(0, 10) : '');
  const [startTime, setStartTime] = useState(lesson.startTime ?? '');
  const [status, setStatus] = useState<LessonStatus>(lesson.status);
  const [notes, setNotes] = useState(lesson.notes || '');
  const [meetingUrl, setMeetingUrl] = useState(lesson.meetingUrl || '');
  const [saving, setSaving] = useState(false);

  // «Запланирован» требует даты — не даём сохранить без неё.
  const plannedWithoutDate = status === 'planned' && !date;
  const valid = title.trim() && !plannedWithoutDate;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdate || !valid) return;
    setSaving(true);
    try {
      await onUpdate(lesson.id, {
        title: title.trim(),
        date: date || null,
        startTime: startTime || null,
        status,
        notes: notes.trim() || null,
        meetingUrl: meetingUrl.trim() || null,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <Field>
        <FieldLabel htmlFor={`edit-title-${lesson.id}`}>Название урока</FieldLabel>
        <Input
          id={`edit-title-${lesson.id}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`edit-date-${lesson.id}`}>Дата</FieldLabel>
          <Input
            id={`edit-date-${lesson.id}`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`edit-time-${lesson.id}`}>Время начала</FieldLabel>
          <Input
            id={`edit-time-${lesson.id}`}
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`edit-status-${lesson.id}`}>Статус</FieldLabel>
        <Select value={status} onValueChange={(v) => setStatus(v as LessonStatus)}>
          <SelectTrigger id={`edit-status-${lesson.id}`} className="w-full">
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
        <FieldLabel htmlFor={`edit-url-${lesson.id}`}>Ссылка на созвон</FieldLabel>
        <Input
          id={`edit-url-${lesson.id}`}
          type="url"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="https://zoom.us/j/..."
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`edit-notes-${lesson.id}`}>Тезисы</FieldLabel>
        <Textarea
          id={`edit-notes-${lesson.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || !valid}>
          {saving && <Loader2 className="animate-spin" />}
          Сохранить
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

interface CreateFormProps {
  defaultDate: string;
  streams: Stream[];
  onCreate?: (data: CalendarCreateData) => Promise<void> | void;
  onCancel: () => void;
  onCreated: () => void;
}

function CreateForm({ defaultDate, streams, onCreate, onCancel, onCreated }: CreateFormProps) {
  const [streamId, setStreamId] = useState(streams[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('');
  const [status, setStatus] = useState<LessonStatus>('planned');
  const [notes, setNotes] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [creating, setCreating] = useState(false);

  // «Запланирован» требует даты.
  const plannedWithoutDate = status === 'planned' && !date;
  const valid = streamId && title.trim() && !plannedWithoutDate;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreate || !valid) return;
    setCreating(true);
    try {
      await onCreate({
        streamId,
        title: title.trim(),
        date,
        startTime: startTime || null,
        status,
        meetingUrl: meetingUrl.trim() || null,
        notes: notes.trim() || null,
      });
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <p className="text-sm font-medium">Новый урок</p>
      {streams.length > 1 && (
        <Field>
          <FieldLabel htmlFor="new-stream">Группа</FieldLabel>
          <Select value={streamId} onValueChange={setStreamId}>
            <SelectTrigger id="new-stream" className="w-full">
              <SelectValue placeholder="Выберите группу" />
            </SelectTrigger>
            <SelectContent>
              {streams.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.status === 'archived' ? '(архив)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="new-title">Название урока</FieldLabel>
        <Input
          id="new-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название нового урока"
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="new-date">Дата</FieldLabel>
          <Input
            id="new-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-time">Время начала</FieldLabel>
          <Input
            id="new-time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="new-status">Статус</FieldLabel>
        <Select value={status} onValueChange={(v) => setStatus(v as LessonStatus)}>
          <SelectTrigger id="new-status" className="w-full">
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
        <FieldLabel htmlFor="new-url">Ссылка на созвон</FieldLabel>
        <Input
          id="new-url"
          type="url"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="https://zoom.us/j/..."
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-notes">Тезисы</FieldLabel>
        <Textarea
          id="new-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Краткое описание того, что будет на уроке..."
          rows={3}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={creating || !valid}>
          {creating && <Loader2 className="animate-spin" />}
          Создать
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
