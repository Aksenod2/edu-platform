'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel } from '@/components/ui/field';
import { MeetingLinkField } from '@/components/schedule/meeting-link-field';
import { RecordingStatusBadge } from '@/components/schedule/recording-status-badge';
import { SummarySourceBadge } from '@/components/schedule/lesson-summary';
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
  createAssignment,
  getAssignments,
  getLesson,
  getLessonSessions,
  getStreams,
  retrySessionRecording,
  unscheduleLesson,
  updateAssignment,
  updateLesson,
  updateLessonSummary,
  type Assignment,
  type Lesson,
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
  // Сохранённые folded-поля задания урока (берём с бэка, а не из формы редактора).
  const [lesson, setLesson] = useState<Lesson | null>(null);
  // Уже выданные задания по этому уроку, ключ — streamId (id = sessionId).
  const [issuedByStream, setIssuedByStream] = useState<Record<string, Assignment>>({});
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
  // Автогенерация Zoom-ссылки: переключатель + результат после сохранения.
  const [generateMeeting, setGenerateMeeting] = useState(false);
  const [savedMeetingUrl, setSavedMeetingUrl] = useState<string | null>(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  // После сохранения с генерацией остаёмся в диалоге показать ссылку.
  const [saved, setSaved] = useState(false);

  // Выдача ДЗ: какой поток сейчас выдаём/правим, значение дедлайна и флаг отправки.
  const [issueStreamId, setIssueStreamId] = useState('');
  const [issueDueDate, setIssueDueDate] = useState('');
  const [issuing, setIssuing] = useState(false);

  // Правка итогов занятия (per-session): какой поток редактируем, черновик и флаг сохранения.
  const [summaryStreamId, setSummaryStreamId] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  // Повтор автозагрузки записи Zoom: streamId занятия, по которому идёт запрос.
  const [retryingStreamId, setRetryingStreamId] = useState('');

  // Подтягиваем выданные задания для всех потоков, где урок запланирован.
  // «Выдано» = есть синтетическое задание (Session) по этому lessonId в потоке.
  const loadIssued = useCallback(
    async (streamIds: string[]) => {
      const entries = await Promise.all(
        streamIds.map(async (sid) => {
          try {
            const { assignments } = await getAssignments(accessToken, sid);
            const match = assignments.find((a) => a.lessonId === lessonId);
            return match ? ([sid, match] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      const map: Record<string, Assignment> = {};
      for (const e of entries) {
        if (e) map[e[0]] = e[1];
      }
      setIssuedByStream(map);
    },
    [accessToken, lessonId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionsRes, streamsRes, lessonRes] = await Promise.all([
        getLessonSessions(accessToken, lessonId),
        getStreams(accessToken),
        getLesson(accessToken, lessonId),
      ]);
      setSessions(sessionsRes.sessions);
      setStreams(streamsRes.streams);
      setLesson(lessonRes.lesson);
      await loadIssued(sessionsRes.sessions.map((s) => s.streamId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки расписания');
    } finally {
      setLoading(false);
    }
  }, [accessToken, lessonId, loadIssued]);

  useEffect(() => {
    load();
  }, [load]);

  const hasAssignment = lesson?.hasAssignment ?? false;

  const activeStreams = streams.filter((s) => s.status === 'active');
  const scheduledIds = new Set(sessions.map((s) => s.streamId));
  const availableStreams = activeStreams.filter((s) => !scheduledIds.has(s.id));

  // Сброс полей результата генерации (общий для открытия add/edit).
  function resetGeneration() {
    setGenerateMeeting(false);
    setSavedMeetingUrl(null);
    setGenerationFailed(false);
    setSaved(false);
  }

  function openAdd() {
    setEditStreamId(null);
    setStreamId(availableStreams.length === 1 ? availableStreams[0].id : '');
    setDate(dateKey(new Date()));
    setStartTime('');
    setMeetingUrl('');
    setStatus('planned');
    resetGeneration();
    setDialogOpen(true);
  }

  function openEdit(s: LessonSession) {
    setEditStreamId(s.streamId);
    setStreamId(s.streamId);
    setDate(s.date ?? '');
    setStartTime(s.startTime ?? '');
    setMeetingUrl(s.meetingUrl ?? '');
    setStatus(s.status);
    resetGeneration();
    setDialogOpen(true);
  }

  const plannedWithoutDate = status === 'planned' && !date;
  const valid = !!streamId && !plannedWithoutDate;

  // Генерацию запрашиваем только если ручную ссылку не вводили (бэк её не перезатирает).
  const wantGenerate = generateMeeting && !meetingUrl.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setGenerationFailed(false);
    try {
      const { lesson: updated } = await updateLesson(accessToken, lessonId, {
        streamId,
        date: date || null,
        startTime: startTime || null,
        status,
        meetingUrl: meetingUrl.trim() || null,
        generateMeeting: wantGenerate,
      });
      await load();
      toast.success(editStreamId ? 'Расписание обновлено' : 'Урок запланирован');
      // Если запрашивали генерацию — остаёмся показать результат (ссылку или ошибку),
      // иначе закрываем диалог как раньше.
      if (wantGenerate) {
        setSaved(true);
        setSavedMeetingUrl(updated.meetingUrl);
        setGenerationFailed(!updated.meetingUrl);
      } else {
        setDialogOpen(false);
      }
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

  // Повторить автозагрузку записи Zoom для зафейленного занятия (админ).
  async function handleRetryRecording(sid: string) {
    if (retryingStreamId) return;
    setRetryingStreamId(sid);
    try {
      const { message } = await retrySessionRecording(accessToken, lessonId, sid);
      await load();
      toast.success(message || 'Перезапустили загрузку записи');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось перезапустить загрузку');
    } finally {
      setRetryingStreamId('');
    }
  }

  // Открыть строку выдачи ДЗ для потока: если уже выдано — подставить дедлайн.
  function openIssue(sid: string) {
    const existing = issuedByStream[sid];
    setIssueStreamId(sid);
    setIssueDueDate(existing?.dueDate ? existing.dueDate.slice(0, 10) : '');
  }

  function cancelIssue() {
    setIssueStreamId('');
    setIssueDueDate('');
  }

  // Выдать ДЗ в поток: createAssignment пишет folded-поля урока в Session и
  // материализует StudentAssignment всем зачисленным студентам потока.
  async function handleIssue(sid: string) {
    if (!lesson || !hasAssignment || issuing) return;
    setIssuing(true);
    try {
      await createAssignment(accessToken, {
        streamId: sid,
        lessonId,
        title: lesson.assignmentTitle?.trim() || lesson.title,
        description: lesson.assignmentDescription || undefined,
        criteria: lesson.assignmentCriteria ?? undefined,
        type: lesson.assignmentType ?? 'short',
        tags: lesson.assignmentTags ?? [],
        materials: lesson.assignmentMaterials ?? [],
        dueDate: issueDueDate || undefined,
      });
      cancelIssue();
      await load();
      toast.success('ДЗ выдано студентам потока');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось выдать ДЗ');
    } finally {
      setIssuing(false);
    }
  }

  // Сменить дедлайн уже выданного ДЗ (id задания = sessionId).
  async function handleUpdateDue(sid: string) {
    const existing = issuedByStream[sid];
    if (!existing || issuing) return;
    setIssuing(true);
    try {
      await updateAssignment(accessToken, existing.id, {
        dueDate: issueDueDate || null,
      });
      cancelIssue();
      await load();
      toast.success('Дедлайн обновлён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось обновить дедлайн');
    } finally {
      setIssuing(false);
    }
  }

  // Открыть редактор итогов занятия конкретного потока (подставив текущий текст).
  function openSummary(s: LessonSession) {
    setSummaryStreamId(s.streamId);
    setSummaryDraft(s.summary ?? '');
  }

  function cancelSummary() {
    setSummaryStreamId('');
    setSummaryDraft('');
  }

  // Сохранить итоги занятия в Session (бэк ставит summarySource='manual', не трогая
  // блочный Lesson.summary). Пустой текст очищает итоги.
  async function handleSaveSummary(sid: string) {
    if (savingSummary) return;
    setSavingSummary(true);
    try {
      await updateLessonSummary(accessToken, lessonId, sid, summaryDraft.trim());
      cancelSummary();
      await load();
      toast.success('Итоги занятия сохранены');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить итоги');
    } finally {
      setSavingSummary(false);
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
          {sessions.map((s) => {
            const issued = issuedByStream[s.streamId];
            const issueOpen = issueStreamId === s.streamId;
            const summaryOpen = summaryStreamId === s.streamId;
            return (
              <div
                key={s.streamId}
                className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.streamName}</span>
                  <Badge variant={STATUS_VARIANT[s.status]} className="font-normal">
                    {LESSON_STATUS_LABELS[s.status]}
                  </Badge>
                  <span className="text-muted-foreground">
                    {s.date ? formatDate(s.date) : 'без даты'}
                    {s.startTime ? `, ${s.startTime}` : ''}
                  </span>
                  {/* Статус автозагрузки записи Zoom — только у прошедшего занятия. */}
                  {s.status === 'done' && (
                    <RecordingStatusBadge
                      status={s.recordingStatus}
                      error={s.recordingError}
                    />
                  )}
                  {hasAssignment && issued && (
                    <Badge variant="outline" className="gap-1 font-normal">
                      <CheckCircle2 className="size-3" />
                      ДЗ выдано
                      {issued.dueDate ? ` · до ${formatDate(issued.dueDate.slice(0, 10))}` : ''}
                    </Badge>
                  )}
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

                {/* Запись Zoom не получена: видимая причина (а не только в title бейджа)
                    + ручной повтор автозагрузки для админа. */}
                {s.status === 'done' && s.recordingStatus === 'failed' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2">
                    <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                      {s.recordingError?.trim() || 'Не удалось получить запись'}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      onClick={() => handleRetryRecording(s.streamId)}
                      disabled={retryingStreamId === s.streamId}
                    >
                      {retryingStreamId === s.streamId ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Повторить
                    </Button>
                  </div>
                )}

                {/* Выдача ДЗ — только если у урока включено folded-задание. */}
                {hasAssignment &&
                  (issueOpen ? (
                    <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted p-2">
                      <Field className="min-w-0 flex-1">
                        <FieldLabel htmlFor={`due-${s.streamId}`} className="text-xs">
                          Дедлайн
                        </FieldLabel>
                        <Input
                          id={`due-${s.streamId}`}
                          type="date"
                          value={issueDueDate}
                          onChange={(e) => setIssueDueDate(e.target.value)}
                          className="h-8"
                        />
                      </Field>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => (issued ? handleUpdateDue(s.streamId) : handleIssue(s.streamId))}
                          disabled={issuing}
                        >
                          {issuing && <Loader2 className="animate-spin" />}
                          {issued ? 'Сохранить дедлайн' : 'Выдать'}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={cancelIssue}>
                          Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant={issued ? 'ghost' : 'outline'}
                      className="w-fit"
                      onClick={() => openIssue(s.streamId)}
                    >
                      <ClipboardCheck className="size-4" />
                      {issued ? 'Изменить дедлайн' : 'Выдать ДЗ'}
                    </Button>
                  ))}

                {/* Итоги занятия (per-session): просмотр с бейджем источника +
                    редактирование. Сохраняется в Session.summary (summarySource='manual'). */}
                {summaryOpen ? (
                  <div className="flex flex-col gap-2 rounded-md bg-muted p-2">
                    <FieldLabel htmlFor={`summary-${s.streamId}`} className="text-xs">
                      Итоги занятия
                    </FieldLabel>
                    <Textarea
                      id={`summary-${s.streamId}`}
                      value={summaryDraft}
                      onChange={(e) => setSummaryDraft(e.target.value)}
                      placeholder="Краткие итоги/конспект занятия для студентов"
                      rows={4}
                      className="bg-card"
                    />
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSaveSummary(s.streamId)}
                        disabled={savingSummary}
                      >
                        {savingSummary && <Loader2 className="animate-spin" />}
                        Сохранить
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={cancelSummary}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : s.summary ? (
                  <div className="flex flex-col gap-1.5 rounded-md bg-muted p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <FileText className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">Итоги занятия</span>
                        <SummarySourceBadge source={s.summarySource} className="font-normal" />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => openSummary(s)}
                      >
                        <Pencil className="size-3.5" />
                        Изменить
                      </Button>
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">{s.summary}</p>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => openSummary(s)}
                  >
                    <FileText className="size-4" />
                    Добавить итоги
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Подсказка: задание у урока выключено — выдавать нечего. */}
      {!loading && sessions.length > 0 && !hasAssignment && (
        <p className="text-xs text-muted-foreground">
          Включите задание в уроке, чтобы выдавать ДЗ в потоки.
        </p>
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

            <MeetingLinkField
              accessToken={accessToken}
              inputId="sched-url"
              value={meetingUrl}
              onValueChange={setMeetingUrl}
              generateMeeting={generateMeeting}
              onGenerateMeetingChange={setGenerateMeeting}
              onConfigLoaded={setGenerateMeeting}
              savedMeetingUrl={savedMeetingUrl}
              generationFailed={generationFailed}
            />

            <DialogFooter>
              {saved ? (
                <Button type="button" onClick={() => setDialogOpen(false)}>
                  Готово
                </Button>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button type="submit" disabled={!valid || saving}>
                    {saving && <Loader2 className="animate-spin" />}
                    Сохранить
                  </Button>
                </>
              )}
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
              variant="destructive"
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
