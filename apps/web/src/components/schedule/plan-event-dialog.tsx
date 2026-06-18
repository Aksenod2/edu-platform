'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  createLesson,
  createMeeting,
  getLessons,
  updateLesson,
  type Lesson,
  type LessonStatus,
  type Meeting,
  type Stream,
} from '@/lib/api';
import { dateKey, nextRoundHour } from '@/components/schedule/utils';
import { LessonFields, NEW_BLOCK } from '@/components/schedule/lesson-fields';
import { MeetingFields } from '@/components/schedule/meeting-fields';

export type EventMode = 'lesson' | 'meeting';

export interface PlanEventDialogProps {
  accessToken: string;
  /** Потоки для режима «Группе». Фильтруем активные внутри. */
  streams?: Stream[];
  /** Предзаполненная дата (вход из дня календаря). */
  defaultDate?: string;
  /** Предвыбранный поток для режима «Группе» (вход со страницы группы). */
  defaultStreamId?: string;
  /** Предвыбранный студент → лочит режим «Студенту», сегмент и пикер скрыты. */
  defaultStudentId?: string;
  defaultStudentName?: string;
  /** Залочить тип события — сегмент скрыт (вход из контекста с одним типом). */
  lockedMode?: EventMode;
  /** Колбэк после успешного создания занятия/встречи (ре-фетч списков). */
  onPlanned?: () => void | Promise<void>;
  /** Колбэк после создания именно встречи (для тоста «Открыть» на карточке студента). */
  onMeetingCreated?: (meeting: Meeting) => void | Promise<void>;
  /** Кастомный триггер. По умолчанию — кнопка «Новое событие». */
  trigger?: ReactNode;
  /** Контролируемое состояние (вход из дня календаря — открытие извне, без триггера). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  /** Дизейблит кнопку-триггер по умолчанию (напр., архивная группа — планировать некуда). */
  triggerDisabled?: boolean;
}

/**
 * Единый вход создания события в расписании (issue #168).
 *
 * Одна точка входа — два типа под капотом: занятие группы (createLesson/updateLesson)
 * и встреча 1-на-1 (createMeeting). Сегмент «Группе / Студенту» выбирает получателя;
 * общее ядро (дата/время/тема) переносится между режимами, структурные поля
 * запоминаются в стейте, но не тащатся в другой режим.
 *
 * Данные и валидация двух типов НЕ смешиваются — едина только точка входа и ядро полей.
 */
export function PlanEventDialog({
  accessToken,
  streams = [],
  defaultDate,
  defaultStreamId,
  defaultStudentId,
  defaultStudentName,
  lockedMode,
  onPlanned,
  onMeetingCreated,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerClassName,
  triggerDisabled,
}: PlanEventDialogProps) {
  const isMobile = useIsMobile();
  const activeStreams = streams.filter((s) => s.status === 'active');

  // Вход с карточки студента — режим залочен на встречу.
  const lockedToMeeting = lockedMode === 'meeting' || !!defaultStudentId;
  const lockedToLesson = lockedMode === 'lesson';
  const hideSegment = lockedToMeeting || lockedToLesson;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (isControlled) controlledOnOpenChange?.(v);
      else setUncontrolledOpen(v);
    },
    [isControlled, controlledOnOpenChange],
  );

  const [mode, setMode] = useState<EventMode>(lockedToMeeting ? 'meeting' : 'lesson');

  // --- Общее ядро (переносится между режимами) ---
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [title, setTitle] = useState('');

  // --- Структурные поля занятия (режим «Группе») ---
  const [streamId, setStreamId] = useState('');
  const [blockId, setBlockId] = useState<string>(NEW_BLOCK);
  const [status, setStatus] = useState<LessonStatus>('planned');
  const [notes, setNotes] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [generateMeeting, setGenerateMeeting] = useState(false);
  const [blocks, setBlocks] = useState<Lesson[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blocksLoaded, setBlocksLoaded] = useState(false);

  // --- Структурные поля встречи (режим «Студенту») ---
  const [studentId, setStudentId] = useState(defaultStudentId ?? '');
  const [noStudents, setNoStudents] = useState(false);

  // --- Результат сохранения с генерацией Zoom-ссылки (только режим «Группе») ---
  const [savedMeetingUrl, setSavedMeetingUrl] = useState<string | null>(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Сброс при открытии. defaultDate/Stream/Student — предзаполнение из точки входа.
  useEffect(() => {
    if (!open) return;
    setMode(lockedToMeeting ? 'meeting' : 'lesson');
    setDate(defaultDate ?? dateKey(new Date()));
    // Время обязательно для напоминаний — предзаполняем ближайшим круглым часом.
    setStartTime(nextRoundHour());
    setTitle('');
    setStreamId(defaultStreamId ?? '');
    setBlockId(NEW_BLOCK);
    setStatus('planned');
    setNotes('');
    setMeetingUrl('');
    setGenerateMeeting(false);
    setStudentId(defaultStudentId ?? '');
    setNoStudents(false);
    setSavedMeetingUrl(null);
    setGenerationFailed(false);
    setSaved(false);
    setError('');
    setBlocks([]);
    setBlocksLoaded(false);
  }, [open, lockedToMeeting, defaultDate, defaultStreamId, defaultStudentId]);

  // Ленивая загрузка копилки уроков — только при первом заходе в режим «Группе».
  useEffect(() => {
    if (!open || mode !== 'lesson' || blocksLoaded || activeStreams.length === 0) return;
    let cancelled = false;
    setBlocksLoading(true);
    getLessons(accessToken)
      .then((res) => {
        if (!cancelled) setBlocks(res.lessons);
      })
      .catch(() => {
        if (!cancelled) setBlocks([]);
      })
      .finally(() => {
        if (!cancelled) {
          setBlocksLoading(false);
          setBlocksLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, blocksLoaded, accessToken, activeStreams.length]);

  // Переключение получателя: общее ядро остаётся, сбрасываем только результат
  // генерации Zoom-ссылки при уходе из «Группе» (структурные поля запоминаются).
  const switchMode = (next: EventMode) => {
    if (next === mode) return;
    if (next === 'meeting') {
      setSavedMeetingUrl(null);
      setGenerationFailed(false);
      setSaved(false);
    }
    setError('');
    setMode(next);
  };

  // Валидация: каждый тип — своя (данные не смешиваем).
  const isNewBlock = blockId === NEW_BLOCK;
  const effectiveLessonTitle = isNewBlock
    ? title.trim()
    : (blocks.find((b) => b.id === blockId)?.title ?? '');
  // Запланированному занятию нужны дата И время начала — иначе не отправить
  // напоминания (push за час / за 15 минут). Встрече — всегда.
  const plannedNeedsTime = status === 'planned';
  const lessonValid =
    !!streamId &&
    !!effectiveLessonTitle &&
    !(plannedNeedsTime && (!date || !startTime)) &&
    activeStreams.length > 0;
  const meetingValid = !!studentId && !!date && !!startTime && !noStudents;
  const valid = mode === 'lesson' ? lessonValid : meetingValid;

  // Генерацию запрашиваем, только если ручную ссылку не вводили.
  const wantGenerate = generateMeeting && !meetingUrl.trim();

  // Поле темы/названия: всегда для встречи; для занятия — только при новом уроке
  // (у существующего блока название берётся из самого урока).
  const showTitleField = mode === 'meeting' || isNewBlock;

  // Время начала обязательно: для встречи — всегда, для занятия — при «Запланировано».
  const timeRequired = mode === 'meeting' || (mode === 'lesson' && status === 'planned');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    setGenerationFailed(false);
    try {
      if (mode === 'meeting') {
        const meeting = await createMeeting(accessToken, {
          studentId,
          date,
          startTime: startTime || null,
          title: title.trim() || null,
        });
        await onPlanned?.();
        await onMeetingCreated?.(meeting);
        setOpen(false);
        return;
      }

      // mode === 'lesson'
      const payload = {
        streamId,
        date: date || null,
        startTime: startTime || null,
        status,
        meetingUrl: meetingUrl.trim() || null,
        generateMeeting: wantGenerate,
      };
      const { lesson } = isNewBlock
        ? await createLesson(accessToken, {
            ...payload,
            title: title.trim(),
            notes: notes.trim() || undefined,
          })
        : // Планируем существующий блок в выбранный поток (бэк апсертит Session).
          // Тезисы не трогаем — у существующего блока они свои.
          await updateLesson(accessToken, blockId, payload);
      await onPlanned?.();
      // Если запрашивали генерацию — остаёмся показать результат, иначе закрываем.
      if (wantGenerate) {
        setSaved(true);
        setSavedMeetingUrl(lesson.meetingUrl);
        setGenerationFailed(!lesson.meetingUrl);
      } else {
        setOpen(false);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === 'meeting'
            ? 'Не удалось запланировать встречу'
            : 'Не удалось запланировать занятие',
      );
    } finally {
      setSaving(false);
    }
  };

  const subtitle =
    mode === 'meeting' ? 'Встреча 1-на-1 со студентом' : 'Занятие для группы';

  // --- Тело формы (общее для Dialog и Sheet) ---
  const body = (
    <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4 sm:px-0 sm:pb-0">
      {!hideSegment && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === 'lesson' ? 'default' : 'outline'}
            onClick={() => switchMode('lesson')}
          >
            Группе
          </Button>
          <Button
            type="button"
            variant={mode === 'meeting' ? 'default' : 'outline'}
            onClick={() => switchMode('meeting')}
          >
            Студенту
          </Button>
        </div>
      )}

      {/* Общее ядро — дата, время, тема (не сбрасывается при переключении). */}
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="plan-date">Дата</FieldLabel>
          <DatePicker id="plan-date" value={date} onChange={(v) => setDate(v ?? '')} />
        </Field>
        <Field>
          <FieldLabel htmlFor="plan-time">
            Время начала
            {timeRequired && <span className="text-destructive"> *</span>}
          </FieldLabel>
          <Input
            id="plan-time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required={timeRequired}
          />
        </Field>
      </div>
      {timeRequired && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Нужно для напоминаний — пришлём push за час и за 15 минут до начала.
        </p>
      )}

      {/* Тема/название. В режиме «Группе» для существующего блока название берётся
          из урока — поле скрываем; для нового урока это его название (обязательно). */}
      {showTitleField && (
        <Field>
          <FieldLabel htmlFor="plan-event-title">
            {mode === 'meeting' ? 'Тема (необязательно)' : 'Название урока'}
          </FieldLabel>
          <Input
            id="plan-event-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              mode === 'meeting' ? 'Например, разбор портфолио' : 'Название нового урока'
            }
            maxLength={500}
            required={mode === 'lesson'}
          />
        </Field>
      )}

      {/* Зависимый блок снизу. */}
      {mode === 'lesson' ? (
        <LessonFields
          accessToken={accessToken}
          activeStreams={activeStreams}
          streamLocked={!!defaultStreamId}
          streamId={streamId}
          onStreamIdChange={setStreamId}
          blockId={blockId}
          onBlockIdChange={setBlockId}
          blocks={blocks}
          blocksLoading={blocksLoading}
          status={status}
          onStatusChange={setStatus}
          hasDate={!!date}
          notes={notes}
          onNotesChange={setNotes}
          meetingUrl={meetingUrl}
          onMeetingUrlChange={setMeetingUrl}
          generateMeeting={generateMeeting}
          onGenerateMeetingChange={setGenerateMeeting}
          savedMeetingUrl={savedMeetingUrl}
          generationFailed={generationFailed}
        />
      ) : defaultStudentId ? (
        // Студент предвыбран (вход с карточки) — пикер скрыт, паритет one-click.
        defaultStudentName && (
          <p className="text-sm text-muted-foreground">
            Встреча со студентом{' '}
            <span className="font-medium text-foreground">{defaultStudentName}</span>.
            Если подключён Zoom, ссылка на созвон создастся автоматически.
          </p>
        )
      ) : (
        <MeetingFields
          accessToken={accessToken}
          studentId={studentId}
          onStudentChange={(id) => setStudentId(id)}
          noStudents={noStudents}
          onNoStudentsChange={setNoStudents}
        />
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Footer
        isMobile={isMobile}
        saved={saved}
        saving={saving}
        valid={valid}
        onClose={() => setOpen(false)}
      />
    </form>
  );

  const titleNode = 'Новое событие';

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        {trigger !== undefined ? (
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        ) : !isControlled ? (
          <SheetTrigger asChild>
            <Button className={cn('w-full', triggerClassName)} disabled={triggerDisabled}>
              <CalendarPlus />
              Новое событие
            </Button>
          </SheetTrigger>
        ) : null}
        <SheetContent side="bottom" className="max-h-[90vh] gap-0 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{titleNode}</SheetTitle>
            <SheetDescription>{subtitle}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : !isControlled ? (
        <DialogTrigger asChild>
          <Button className={cn(triggerClassName)} disabled={triggerDisabled}>
            <CalendarPlus />
            Новое событие
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titleNode}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function Footer({
  isMobile,
  saved,
  saving,
  valid,
  onClose,
}: {
  isMobile: boolean;
  saved: boolean;
  saving: boolean;
  valid: boolean;
  onClose: () => void;
}) {
  const content = saved ? (
    <Button type="button" onClick={onClose}>
      Готово
    </Button>
  ) : (
    <>
      <Button type="button" variant="ghost" onClick={onClose}>
        Отмена
      </Button>
      <Button type="submit" disabled={!valid || saving}>
        {saving && <Loader2 className="animate-spin" />}
        Запланировать
      </Button>
    </>
  );

  return isMobile ? (
    <SheetFooter className="px-0">{content}</SheetFooter>
  ) : (
    <DialogFooter>{content}</DialogFooter>
  );
}
