'use client';

import { useEffect, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MeetingLinkField } from '@/components/schedule/meeting-link-field';
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
  triggerClassName,
}: {
  accessToken: string;
  streams: Stream[];
  /** Предвыбранный поток (если на странице выбран конкретный). */
  defaultStreamId?: string;
  onPlanned: () => void | Promise<void>;
  /** Доп. классы для кнопки-триггера (например, w-full на мобилке). */
  triggerClassName?: string;
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
  // Автогенерация Zoom-ссылки: переключатель + результат после сохранения.
  const [generateMeeting, setGenerateMeeting] = useState(false);
  const [savedMeetingUrl, setSavedMeetingUrl] = useState<string | null>(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  // После успешного сохранения с генерацией остаёмся в диалоге показать ссылку.
  const [saved, setSaved] = useState(false);

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
    setGenerateMeeting(false);
    setSavedMeetingUrl(null);
    setGenerationFailed(false);
    setSaved(false);
    setError('');

    let cancelled = false;
    setBlocksLoading(true);
    getLessons(accessToken)
      .then((res) => {
        if (cancelled) return;
        // Копилка отдаёт блоки-уроки с уникальными id — дедуп не нужен.
        setBlocks(res.lessons);
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

  // Генерацию запрашиваем только если ручную ссылку не вводили (бэк её не перезатирает).
  const wantGenerate = generateMeeting && !meetingUrl.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    setGenerationFailed(false);
    try {
      const payload = {
        streamId,
        date: date || null,
        startTime: startTime || null,
        status,
        meetingUrl: meetingUrl.trim() || null,
        generateMeeting: wantGenerate,
      };
      const { lesson } = isNewBlock
        ? await createLesson(accessToken, { ...payload, title: title.trim() })
        : // Планируем существующий блок в выбранный поток: бэк апсертит Session.
          await updateLesson(accessToken, blockId, payload);
      await onPlanned();
      // Если запрашивали генерацию — остаёмся показать результат (ссылку или ошибку),
      // иначе закрываем диалог как раньше.
      if (wantGenerate) {
        setSaved(true);
        setSavedMeetingUrl(lesson.meetingUrl);
        setGenerationFailed(!lesson.meetingUrl);
      } else {
        setOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось запланировать занятие');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={activeStreams.length === 0} className={cn(triggerClassName)}>
          <CalendarPlus />
          Запланировать занятие
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Запланировать занятие</DialogTitle>
          <DialogDescription>
            Поставьте урок-блок в группу на дату или создайте новый урок.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="plan-stream">Группа</FieldLabel>
            <Select value={streamId} onValueChange={setStreamId}>
              <SelectTrigger id="plan-stream" className="w-full">
                <SelectValue placeholder="Выберите группу" />
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

          <MeetingLinkField
            accessToken={accessToken}
            inputId="plan-url"
            value={meetingUrl}
            onValueChange={setMeetingUrl}
            generateMeeting={generateMeeting}
            onGenerateMeetingChange={setGenerateMeeting}
            onConfigLoaded={setGenerateMeeting}
            savedMeetingUrl={savedMeetingUrl}
            generationFailed={generationFailed}
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            {saved ? (
              <Button type="button" onClick={() => setOpen(false)}>
                Готово
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={!valid || saving}>
                  {saving && <Loader2 className="animate-spin" />}
                  Запланировать
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
