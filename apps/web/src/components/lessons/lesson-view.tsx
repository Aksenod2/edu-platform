'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Loader2,
  Tag,
  Users,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaterialRow } from '@/components/material-row';
import { useAuth } from '@/lib/auth-context';
import { VideoEmbedFrame, VideoFileFrame } from '@/components/lessons/video-frame';
import { RecordingStatusBadge } from '@/components/schedule/recording-status-badge';
import { SessionStatusControl } from '@/components/schedule/session-status-control';
import { SummarySourceBadge } from '@/components/schedule/lesson-summary';
import { LessonAnalyticsSection } from '@/components/lessons/lesson-analytics-section';
import { LessonAttendanceSection } from '@/components/lessons/lesson-attendance-section';
import { parseVideoEmbed } from '@/lib/video-embed';
import {
  LESSON_STATUS_LABELS,
  STATUS_BADGE_VARIANT,
} from '@/components/schedule/utils';
import {
  createAssignment,
  getAssignments,
  getLesson,
  getLessonSessions,
  type Assignment,
  type Lesson,
  type LessonSession,
  type LessonStatus,
} from '@/lib/api';

type LessonWithAssignments = Lesson & { assignments?: Assignment[] };

const ASSIGNMENT_TYPE_LABELS: Record<'short' | 'long', string> = {
  short: 'Короткое',
  long: 'Развёрнутое',
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// Любое учебное видео урока (несколько videos / одиночное videoFileUrl / videoUrl)?
function hasLessonVideo(lesson: Lesson): boolean {
  return !!(
    (lesson.videos && lesson.videos.length > 0) ||
    lesson.videoFileUrl ||
    lesson.videoUrl
  );
}

/**
 * View Mode урока для админа/препода — читаемый экран (не редактор).
 *
 * Контекст занятия: при streamId показываем блок «Это занятие» по конкретному
 * потоку (статус/дата/запись/итоги из Session) + post-session CTA (выдать ДЗ /
 * проверить сдачи) + статистику сдач. Без streamId — урок-шаблон (видео,
 * материалы, задание, преподаватели) и список занятий по потокам.
 *
 * Редактирование контента, расписания, выдача/итоги/запись — в режиме
 * «Редактирование» (LessonBlockEditor + LessonScheduleSection), ссылка на него —
 * кнопкой «Редактировать».
 */
export function LessonView({
  lessonId,
  streamId,
}: {
  lessonId: string;
  streamId?: string;
}) {
  const { accessToken } = useAuth();
  const [lesson, setLesson] = useState<LessonWithAssignments | null>(null);
  const [sessions, setSessions] = useState<LessonSession[]>([]);
  // Выданное ДЗ по текущему потоку (если streamId задан): match по lessonId.
  const [issued, setIssued] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Диалог выдачи ДЗ (post-session CTA): дедлайн + флаг отправки.
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueDue, setIssueDue] = useState('');
  const [issuing, setIssuing] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [{ lesson: l }, { sessions: s }] = await Promise.all([
        getLesson(accessToken, lessonId),
        getLessonSessions(accessToken, lessonId),
      ]);
      setLesson(l);
      setSessions(s);
      // Выданное ДЗ ищем только в контексте потока (для CTA «Выдать/Проверить»).
      if (streamId) {
        try {
          const { assignments } = await getAssignments(accessToken, streamId);
          setIssued(assignments.find((a) => a.lessonId === lessonId) ?? null);
        } catch {
          setIssued(null);
        }
      } else {
        setIssued(null);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки урока');
    } finally {
      setLoading(false);
    }
  }, [accessToken, lessonId, streamId]);

  useEffect(() => {
    load();
  }, [load]);

  // Занятие текущего потока (если открыли с ?streamId).
  const session = useMemo(
    () => (streamId ? sessions.find((s) => s.streamId === streamId) ?? null : null),
    [sessions, streamId],
  );

  // Выдать ДЗ в поток: тот же контракт, что в LessonScheduleSection.handleIssue.
  async function handleIssue() {
    if (!lesson || !streamId || !accessToken || issuing) return;
    setIssuing(true);
    try {
      await createAssignment(accessToken, {
        streamId,
        lessonId,
        title: lesson.assignmentTitle?.trim() || lesson.title,
        description: lesson.assignmentDescription || undefined,
        criteria: lesson.assignmentCriteria ?? undefined,
        type: lesson.assignmentType ?? 'short',
        tags: lesson.assignmentTags ?? [],
        materials: lesson.assignmentMaterials ?? [],
        dueDate: issueDue || undefined,
      });
      setIssueOpen(false);
      setIssueDue('');
      await load();
      toast.success('ДЗ выдано студентам группы');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось выдать ДЗ');
    } finally {
      setIssuing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error || 'Урок не найден'}</AlertDescription>
      </Alert>
    );
  }

  const hasAssignment = lesson.hasAssignment ?? false;
  const embedUrl = lesson.videoUrl ? parseVideoEmbed(lesson.videoUrl) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Заголовок урока. Переключение Просмотр/Редактирование — в табах на
          странице урока (page.tsx), отдельные кнопки под заголовком не нужны. */}
      <h1 className="text-2xl font-bold tracking-tight">{lesson.title}</h1>

      {/* ── Контекст занятия (есть только при ?streamId) ───────────────────── */}
      {streamId && (
        <SessionContextCard
          session={session}
          lessonId={lessonId}
          streamId={streamId}
          onChanged={load}
        />
      )}

      {/* Post-session CTA: занятие проведено + у урока есть ДЗ-шаблон.
          Не выдано → primary «Выдать ДЗ»; выдано → «Проверить сдачи». */}
      {streamId && session?.status === 'done' && hasAssignment && (
        <PostSessionCta
          issued={issued}
          onIssue={() => {
            setIssueDue('');
            setIssueOpen(true);
          }}
        />
      )}

      {/* Статистика сдач по занятию (только в контексте потока). */}
      {streamId && (
        <LessonAnalyticsSection
          accessToken={accessToken!}
          lessonId={lessonId}
          streamId={streamId}
          assignmentId={issued?.id ?? null}
        />
      )}

      {/* Посещаемость занятия (только в контексте потока). */}
      {streamId && (
        <LessonAttendanceSection
          accessToken={accessToken!}
          lessonId={lessonId}
          streamId={streamId}
        />
      )}

      {/* ── Учебный контент урока-шаблона (read-only) ──────────────────────── */}
      {hasLessonVideo(lesson) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="size-5 shrink-0 text-muted-foreground" />
              Учебное видео урока
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {lesson.videos && lesson.videos.length > 0 ? (
              lesson.videos.map((video) => {
                const videoEmbed = video.kind === 'link' ? parseVideoEmbed(video.url) : null;
                return (
                  <div key={video.id} className="flex flex-col gap-2">
                    {video.title && <div className="text-sm font-medium">{video.title}</div>}
                    {video.kind === 'file' ? (
                      <VideoFileFrame src={video.url} label={video.title ?? lesson.title} />
                    ) : videoEmbed ? (
                      <VideoEmbedFrame src={videoEmbed} title={video.title ?? lesson.title} />
                    ) : (
                      <Button asChild variant="outline" className="w-fit">
                        <a href={video.url} target="_blank" rel="noopener noreferrer">
                          Смотреть видео
                          <ExternalLink className="size-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                );
              })
            ) : lesson.videoFileUrl ? (
              <VideoFileFrame src={lesson.videoFileUrl} label={lesson.title} />
            ) : embedUrl ? (
              <VideoEmbedFrame src={embedUrl} title={lesson.title} />
            ) : (
              lesson.videoUrl && (
                <Button asChild variant="outline" className="w-fit">
                  <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer">
                    Смотреть видео
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              )
            )}
          </CardContent>
        </Card>
      )}

      {lesson.summary && (
        <Card>
          <CardHeader>
            <CardTitle>Краткое описание</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {lesson.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Заметки преподавателя — видны только преподавателям (это админский экран). */}
      {lesson.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-5 shrink-0 text-muted-foreground" />
              Заметки преподавателя
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {lesson.notes}
            </p>
          </CardContent>
        </Card>
      )}

      {lesson.materials && lesson.materials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Материалы</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {lesson.materials.map((m) => (
              <MaterialRow key={m.s3Key} material={m} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Свёрнутое задание урока (шаблон ДЗ) — read-only превью. */}
      {hasAssignment && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="size-5 shrink-0 text-muted-foreground" />
              Задание к уроку
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {lesson.assignmentTitle?.trim() || lesson.title}
              </span>
              <Badge variant="secondary" className="font-normal">
                {ASSIGNMENT_TYPE_LABELS[lesson.assignmentType ?? 'short']}
              </Badge>
            </div>
            {lesson.assignmentDescription && (
              <p className="whitespace-pre-wrap text-muted-foreground">
                {lesson.assignmentDescription}
              </p>
            )}
            {lesson.assignmentCriteria && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Критерии оценки</span>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {lesson.assignmentCriteria}
                </p>
              </div>
            )}
            {lesson.assignmentTags && lesson.assignmentTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag className="size-3.5 text-muted-foreground" />
                {lesson.assignmentTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            {lesson.assignmentMaterials && lesson.assignmentMaterials.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Материалы задания</span>
                {lesson.assignmentMaterials.map((m, i) => (
                  <a
                    key={`${m.url}-${i}`}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-md border p-2 text-foreground transition-colors hover:bg-accent/50"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {lesson.teachers && lesson.teachers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5 shrink-0 text-muted-foreground" />
              Преподаватели
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {lesson.teachers.map((t) => (
              <Badge key={t.id} variant="secondary" className="font-normal">
                {t.name}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Список занятий по потокам (когда смотрим урок-шаблон без потока) ── */}
      {!streamId && <SessionsListCard sessions={sessions} lessonId={lessonId} />}

      {/* Диалог выдачи ДЗ (дедлайн). */}
      <Dialog open={issueOpen} onOpenChange={(o) => !issuing && setIssueOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Выдать ДЗ группе</DialogTitle>
            <DialogDescription>
              Задание материализуется всем студентам группы. Дедлайн необязателен.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="issue-due">Дедлайн</FieldLabel>
            <Input
              id="issue-due"
              type="date"
              value={issueDue}
              onChange={(e) => setIssueDue(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIssueOpen(false)} disabled={issuing}>
              Отмена
            </Button>
            <Button onClick={handleIssue} disabled={issuing}>
              {issuing && <Loader2 className="animate-spin" />}
              Выдать ДЗ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Блок «Это занятие»: статус/дата/ссылка/запись/итоги конкретного Session потока.
function SessionContextCard({
  session,
  lessonId,
  streamId,
  onChanged,
}: {
  session: LessonSession | null;
  lessonId: string;
  streamId: string;
  onChanged: () => void;
}) {
  const router = useRouter();
  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
            Это занятие
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Этот урок ещё не запланирован занятием в выбранной группе. Запланируйте его в
            режиме редактирования.
          </p>
        </CardContent>
      </Card>
    );
  }

  const status = session.status as LessonStatus;
  const hasRecording = !!(session.recordingFileUrl || session.recordingVideoUrl);
  const recordingEmbed = session.recordingVideoUrl
    ? parseVideoEmbed(session.recordingVideoUrl)
    : null;
  const canJoin = status === 'planned' && !!session.meetingUrl;
  // Состояние автозагрузки записи Zoom. Показываем его, как только оно появилось
  // (не дожидаясь done и не дожидаясь готового файла) — чтобы сразу после занятия
  // было видно «ждём видео». Инфоблок не нужен, когда плеер записи уже есть.
  const recState = session.recordingStatus;
  const showRecordingStatus =
    !hasRecording && !!recState && recState !== 'none' && recState !== 'ready';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
            Это занятие
          </CardTitle>
          {/* Бейдж статуса = контрол смены статуса (дропдаун + «Провести»).
              От «Проведён» зависят ДЗ/запись/посещаемость → onChanged перезагружает
              данные урока. «Запланирован» без даты → ведём в редактирование. */}
          <SessionStatusControl
            lessonId={lessonId}
            streamId={streamId}
            status={status}
            hasDate={!!session.date}
            onChanged={onChanged}
            onEditRequest={() =>
              router.push(`/admin/lessons/${lessonId}?mode=edit&streamId=${streamId}`)
            }
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5 font-medium">
            <Users className="size-4 text-muted-foreground" />
            {session.streamName}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="size-4" />
            {session.date ? formatDate(session.date) : 'без даты'}
            {session.startTime ? `, ${session.startTime}` : ''}
          </span>
        </div>

        {/* Состояние записи занятия — понятным инфоблоком, как только оно есть
            (раньше done): после проведения сразу видно «занятие завершилось,
            ждём видео от Zoom». При готовой записи блок скрыт — ниже сам плеер. */}
        {showRecordingStatus && (
          <div className="flex flex-col gap-1 rounded-md border bg-muted/50 p-3">
            <RecordingStatusBadge
              status={recState}
              error={session.recordingError}
              className="w-fit"
            />
            <p className="text-xs text-muted-foreground">
              {recState === 'failed'
                ? session.recordingError?.trim() ||
                  'Запись с Zoom не получена — обновите позже или перезапустите загрузку в режиме редактирования.'
                : 'Занятие завершилось. Запись подтянется автоматически из Zoom — обычно в течение нескольких минут.'}
            </p>
          </div>
        )}

        {canJoin && (
          <Button asChild variant="secondary" className="w-fit">
            <a href={session.meetingUrl!} target="_blank" rel="noopener noreferrer">
              <Video className="size-4" />
              Присоединиться к созвону
              <ExternalLink className="size-4" />
            </a>
          </Button>
        )}

        {/* Запись занятия (если есть) — встроенный плеер или ссылка. */}
        {hasRecording && (
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Video className="size-3.5" />
              Запись занятия
            </span>
            {session.recordingFileUrl ? (
              <VideoFileFrame
                src={session.recordingFileUrl}
                label={`Запись занятия — ${session.streamName}`}
              />
            ) : recordingEmbed ? (
              <VideoEmbedFrame
                src={recordingEmbed}
                title={`Запись занятия — ${session.streamName}`}
              />
            ) : (
              <Button asChild variant="outline" className="w-fit">
                <a href={session.recordingVideoUrl!} target="_blank" rel="noopener noreferrer">
                  <Video className="size-4" />
                  Смотреть запись
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            )}
          </div>
        )}

        {/* Итоги занятия (Session.summary) с бейджем источника. */}
        {session.summary && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileText className="size-3.5" />
                  Итоги занятия
                </span>
                <SummarySourceBadge source={session.summarySource} className="font-normal" />
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {session.summary}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Post-session CTA: заметный primary «Выдать ДЗ» или «Проверить сдачи (N)».
function PostSessionCta({
  issued,
  onIssue,
}: {
  issued: Assignment | null;
  onIssue: () => void;
}) {
  if (issued) {
    const submitted = issued._count?.studentAssignments ?? 0;
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">ДЗ выдано группе</span>
            <span className="text-sm text-muted-foreground">
              {issued.dueDate
                ? `Дедлайн: ${formatDate(issued.dueDate)}`
                : 'Без дедлайна'}
            </span>
          </div>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href={`/admin/assignments/${issued.id}`}>
            <ClipboardCheck className="size-4" />
            {submitted > 0 ? `Проверить сдачи (${submitted})` : 'Проверить сдачи'}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Занятие проведено — выдайте ДЗ</span>
          <span className="text-sm text-muted-foreground">
            Студенты группы получат задание к этому уроку.
          </span>
        </div>
      </div>
      <Button onClick={onIssue} className="w-full sm:w-auto">
        <ClipboardCheck className="size-4" />
        Выдать ДЗ
      </Button>
    </div>
  );
}

// Список занятий урока по потокам (для урока-шаблона без выбранного потока).
function SessionsListCard({
  sessions,
  lessonId,
}: {
  sessions: LessonSession[];
  lessonId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
          Занятия по группам
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Урок ещё не запланирован ни в одной группе. Поставьте его в расписание в режиме
            редактирования.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((s) => (
              <Link
                key={s.streamId}
                href={`/admin/lessons/${lessonId}?streamId=${s.streamId}`}
                className="no-underline"
              >
                <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 transition-colors hover:bg-accent/50">
                  <span className="font-medium">{s.streamName}</span>
                  <Badge variant={STATUS_BADGE_VARIANT[s.status]} className="font-normal">
                    {LESSON_STATUS_LABELS[s.status]}
                  </Badge>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="size-3.5" />
                    {s.date ? formatDate(s.date) : 'без даты'}
                    {s.startTime ? `, ${s.startTime}` : ''}
                  </span>
                  <ExternalLink className="ml-auto size-4 shrink-0 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
