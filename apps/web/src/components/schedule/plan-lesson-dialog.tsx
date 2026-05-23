'use client';

import { useEffect, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createLesson,
  getLessons,
  updateLesson,
  type Lesson,
  type LessonStatus,
  type Stream,
} from '@/lib/api';
import {
  LESSON_STATUS_LABELS,
  STATUS_ORDER,
  dateKey,
} from '@/components/schedule/utils';

const NEW_BLOCK = '__new__';

/**
 * Диалог «Запланировать занятие».
 *
 * Планирование = взять существующий блок-урок (копилка `getLessons` без streamId)
 * либо ввести новый title, выбрать поток, дату/время/ссылку/статус.
 *  - Существующий блок → `updateLesson(blockId, { streamId, ... })` (бэк апсертит
 *    Session(streamId, lessonId), т.е. планирует блок в выбранный поток).
 *  - Новый title → `createLesson({ streamId, title, ... })` (создаёт урок+занятие).
 */
export function PlanLessonDialog({
  accessToken,
  streams,
  defaultStreamId,
  onPlanned,
}: {
  accessToken: string;
  streams: Stream[];
  /** Предвыбранный поток (если на странице выбран конкретный). */
  defaultStreamId?: string;
  onPlanned: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  // Активные потоки для планирования.
  const activeStreams = streams.filter((s) => s.status === 'active');

  const [streamId, setStreamId] = useState(defaultStreamId ?? '');
  const [blockId, setBlockId] = useState<string>(NEW_BLOCK);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dateKey(new Date()));
  const [startTime, setStartTime] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [status, setStatus] = useState<LessonStatus>('planned');

  const [blocks, setBlocks] = useState<Lesson[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Загружаем копилку блоков-уроков при открытии диалога.
  useEffect(() => {
    if (!open) return;
    setStreamId(defaultStreamId ?? '');
    setBlockId(NEW_BLOCK);
    setTitle('');
    setDate(dateKey(new Date()));
    setStartTime('');
    setMeetingUrl('');
    setStatus('planned');
    setError('');

    let cancelled = false;
    setBlocksLoading(true);
    getLessons(accessToken)
      .then((res) => {
        if (cancelled) return;
        // Уникальные блоки по title (копилка отдаёт уроки-шаблоны без потока).
        const seen = new Set<string>();
        const unique = res.lessons.filter((l) => {
          const key = l.title.trim().toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setBlocks(unique);
      })
      .catch(() => {
        if (!cancelled) setBlocks([]);
      })
      .finally(() => {
        if (!cancelled) setBlocksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, accessToken, defaultStreamId]);

  const isNewBlock = blockId === NEW_BLOCK;
  const plannedWithoutDate = status === 'planned' && !date;
  const effectiveTitle = isNewBlock
    ? title.trim()
    : (blocks.find((b) => b.id === blockId)?.title ?? '');
  const valid = !!streamId && !!effectiveTitle && !plannedWithoutDate;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      if (isNewBlock) {
        await createLesson(accessToken, {
          streamId,
          title: title.trim(),
          date: date || null,
          startTime: startTime || null,
          status,
          meetingUrl: meetingUrl.trim() || null,
        });
      } else {
        // Планируем существующий блок в выбранный поток: бэк апсертит Session.
        await updateLesson(accessToken, blockId, {
          streamId,
          date: date || null,
          startTime: startTime || null,
          status,
          meetingUrl: meetingUrl.trim() || null,
        });
      }
      await onPlanned();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось запланировать занятие');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={activeStreams.length === 0}>
          <CalendarPlus />
          Запланировать занятие
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Запланировать занятие</DialogTitle>
          <DialogDescription>
            Поставьте урок-блок в поток на дату или создайте новый урок.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="plan-stream">Поток</FieldLabel>
            <Select value={streamId} onValueChange={setStreamId}>
              <SelectTrigger id="plan-stream" className="w-full">
                <SelectValue placeholder="Выберите поток" />
              </SelectTrigger>
              <SelectContent>
                {activeStreams.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="plan-block">Урок</FieldLabel>
            <Select value={blockId} onValueChange={setBlockId} disabled={blocksLoading}>
              <SelectTrigger id="plan-block" className="w-full">
                <SelectValue placeholder="Выберите урок" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_BLOCK}>+ Новый урок</SelectItem>
                {blocks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {blocksLoading && (
              <p className="text-xs text-muted-foreground">Загрузка списка уроков…</p>
            )}
          </Field>

          {isNewBlock && (
            <Field>
              <FieldLabel htmlFor="plan-title">Название урока</FieldLabel>
              <Input
                id="plan-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Название нового урока"
                required
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="plan-date">Дата</FieldLabel>
              <Input
                id="plan-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="plan-time">Время начала</FieldLabel>
              <Input
                id="plan-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="plan-status">Статус</FieldLabel>
            <Select value={status} onValueChange={(v) => setStatus(v as LessonStatus)}>
              <SelectTrigger id="plan-status" className="w-full">
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
            <FieldLabel htmlFor="plan-url">Ссылка на созвон</FieldLabel>
            <Input
              id="plan-url"
              type="url"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://zoom.us/j/..."
            />
          </Field>

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
