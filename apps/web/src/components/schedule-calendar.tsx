'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Lesson, ScheduleEntry, Stream } from '@/lib/api';

export type CalendarEntry = ScheduleEntry & { streamName?: string };

interface CreateData {
  streamId: string;
  lessonId: string;
  date: string;
  startTime: string;
  notes?: string;
  meetingUrl?: string;
}

interface UpdateData {
  date?: string;
  startTime?: string;
  lessonId?: string;
  notes?: string | null;
  meetingUrl?: string | null;
}

interface ScheduleCalendarProps {
  entries: CalendarEntry[];
  editable?: boolean;
  streams?: Stream[];
  lessons?: Lesson[];
  onCreate?: (data: CreateData) => Promise<void> | void;
  onUpdate?: (id: string, data: UpdateData) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Парсит дату из ISO-строки как локальную (без UTC-сдвига). */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

/** Ключ "YYYY-MM-DD" из локальной даты. */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function ScheduleCalendar({
  entries,
  editable = false,
  streams = [],
  lessons = [],
  onCreate,
  onUpdate,
  onDelete,
}: ScheduleCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Группировка записей по дню "YYYY-MM-DD"
  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const key = dateKey(parseLocalDate(e.date));
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return map;
  }, [entries]);

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

  const selectedEntries = selectedKey ? entriesByDay.get(selectedKey) ?? [] : [];

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
          {WEEKDAYS.map((w) => (
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
            const dayEntries = entriesByDay.get(key) ?? [];
            const inMonth = day.getMonth() === viewMonth;
            const isToday = isSameDay(day, today);
            const visible = dayEntries.slice(0, 3);
            const extra = dayEntries.length - visible.length;

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
                  {visible.map((e) => (
                    <span
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedKey(key);
                      }}
                      className="flex flex-col rounded-sm bg-secondary px-1.5 py-1 text-left text-secondary-foreground"
                    >
                      <span className="truncate text-xs font-medium leading-tight">
                        {e.lessonTitle || e.lesson?.title}
                      </span>
                      <span className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                        {e.streamName && (
                          <span className="truncate">{e.streamName}</span>
                        )}
                        <span className="shrink-0 font-mono">{e.startTime}</span>
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
              entries={selectedEntries}
              editable={editable}
              streams={streams}
              lessons={lessons}
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
  entries: CalendarEntry[];
  editable: boolean;
  streams: Stream[];
  lessons: Lesson[];
  onCreate?: (data: CreateData) => Promise<void> | void;
  onUpdate?: (id: string, data: UpdateData) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
}

function DayDetail({
  dayKey,
  entries,
  editable,
  streams,
  lessons,
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
          {entries.length > 0
            ? `Занятий: ${entries.length}`
            : 'На этот день занятий нет'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-3 px-4 pb-4">
        {entries.map((entry) =>
          editable && editingId === entry.id ? (
            <EditForm
              key={entry.id}
              entry={entry}
              lessons={lessons}
              onCancel={() => setEditingId(null)}
              onUpdate={onUpdate}
              onSaved={() => setEditingId(null)}
            />
          ) : (
            <div key={entry.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <p className="font-medium leading-tight">{entry.lessonTitle || entry.lesson?.title}</p>
                  {entry.streamName && (
                    <Badge variant="secondary" className="w-fit">
                      {entry.streamName}
                    </Badge>
                  )}
                </div>
                <span className="shrink-0 font-mono text-sm text-muted-foreground">
                  {entry.startTime}
                </span>
              </div>
              {entry.notes && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {entry.notes}
                </p>
              )}
              {entry.meetingUrl && (
                <a
                  href={entry.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block no-underline"
                >
                  <Button size="sm">Присоединиться</Button>
                </a>
              )}
              {editable && (
                <>
                  <Separator className="my-3" />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingId(entry.id)}
                    >
                      Редактировать
                    </Button>
                    <DeleteButton id={entry.id} onDelete={onDelete} />
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
                lessons={lessons}
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
                Добавить занятие
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
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={busy}
      onClick={async () => {
        if (!onDelete) return;
        if (!confirm('Удалить запись из расписания?')) return;
        setBusy(true);
        try {
          await onDelete(id);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 className="animate-spin" />}
      Удалить
    </Button>
  );
}

interface EditFormProps {
  entry: CalendarEntry;
  lessons: Lesson[];
  onCancel: () => void;
  onSaved: () => void;
  onUpdate?: (id: string, data: UpdateData) => Promise<void> | void;
}

function EditForm({ entry, lessons, onCancel, onSaved, onUpdate }: EditFormProps) {
  const [date, setDate] = useState(entry.date.slice(0, 10));
  const [startTime, setStartTime] = useState(entry.startTime);
  const [lessonId, setLessonId] = useState(entry.lessonId ?? '');
  const [notes, setNotes] = useState(entry.notes || '');
  const [meetingUrl, setMeetingUrl] = useState(entry.meetingUrl || '');
  const [saving, setSaving] = useState(false);

  const streamLessons = useMemo(
    () => lessons.filter((l) => l.streamId === entry.streamId),
    [lessons, entry.streamId],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdate || !lessonId) return;
    setSaving(true);
    try {
      await onUpdate(entry.id, {
        date,
        startTime,
        lessonId,
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
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`edit-date-${entry.id}`}>Дата</FieldLabel>
          <Input
            id={`edit-date-${entry.id}`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`edit-time-${entry.id}`}>Время начала</FieldLabel>
          <Input
            id={`edit-time-${entry.id}`}
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`edit-lesson-${entry.id}`}>Урок</FieldLabel>
        {streamLessons.length > 0 ? (
          <Select value={lessonId} onValueChange={setLessonId}>
            <SelectTrigger id={`edit-lesson-${entry.id}`} className="w-full">
              <SelectValue placeholder="Выберите урок" />
            </SelectTrigger>
            <SelectContent>
              {streamLessons.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">В этом потоке нет уроков</p>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`edit-notes-${entry.id}`}>Тезисы</FieldLabel>
        <Textarea
          id={`edit-notes-${entry.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`edit-url-${entry.id}`}>Ссылка на созвон</FieldLabel>
        <Input
          id={`edit-url-${entry.id}`}
          type="url"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="https://zoom.us/j/..."
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || !lessonId}>
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
  lessons: Lesson[];
  onCreate?: (data: CreateData) => Promise<void> | void;
  onCancel: () => void;
  onCreated: () => void;
}

function CreateForm({ defaultDate, streams, lessons, onCreate, onCancel, onCreated }: CreateFormProps) {
  const [streamId, setStreamId] = useState(streams[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [notes, setNotes] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const streamLessons = useMemo(
    () => lessons.filter((l) => l.streamId === streamId),
    [lessons, streamId],
  );

  const valid = streamId && date && startTime && lessonId;

  const onStreamChange = (value: string) => {
    setStreamId(value);
    setLessonId('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreate || !valid) return;
    setCreating(true);
    try {
      await onCreate({
        streamId,
        lessonId,
        date,
        startTime,
        notes: notes.trim() || undefined,
        meetingUrl: meetingUrl.trim() || undefined,
      });
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <p className="text-sm font-medium">Новое занятие</p>
      <Field>
        <FieldLabel htmlFor="new-stream">Поток</FieldLabel>
        <Select value={streamId} onValueChange={onStreamChange}>
          <SelectTrigger id="new-stream" className="w-full">
            <SelectValue placeholder="Выберите поток" />
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
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="new-date">Дата</FieldLabel>
          <Input
            id="new-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-time">Время начала</FieldLabel>
          <Input
            id="new-time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="new-lesson">Урок</FieldLabel>
        {streamLessons.length > 0 ? (
          <Select value={lessonId} onValueChange={setLessonId}>
            <SelectTrigger id="new-lesson" className="w-full">
              <SelectValue placeholder="Выберите урок" />
            </SelectTrigger>
            <SelectContent>
              {streamLessons.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">В этом потоке нет уроков</p>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="new-notes">Тезисы</FieldLabel>
        <Textarea
          id="new-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Краткое описание того, что будет на занятии..."
          rows={3}
        />
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
