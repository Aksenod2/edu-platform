'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  ScrollText,
  Video,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@platform/ui/lib/utils';
import { useAuth } from '@/lib/auth-context';
import {
  cancelMeeting,
  fileDownloadUrl,
  getMeeting,
  getMeetingTranscript,
  type Meeting,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { BackButton } from '@/components/back-button';
import { MarkdownContent } from '@/components/markdown/markdown-content';
import { LessonStatusBadge } from '@/components/schedule/lesson-status-badge';
import type { LessonStatus } from '@/lib/api';
import { SummarySourceBadge } from '@/components/schedule/lesson-summary';
import { VideoEmbedFrame, VideoFileFrame } from '@/components/lessons/video-frame';
import {
  resolveProcessingKind,
  RECORDING_STALE_AFTER_MS,
  SUMMARY_STALE_AFTER_MS,
  TRANSCRIPT_STALE_AFTER_MS,
} from '@/components/schedule/processing-status';
import { parseLocalDate } from '@/components/schedule/utils';
import { parseVideoEmbed } from '@/lib/video-embed';
import { MEETING_FALLBACK_TITLE } from '@/components/meetings/utils';

/**
 * Детальная страница встречи 1-на-1 (общий компонент для админа и студента).
 *
 * Показывает: шапку (статус, тема, дата/время, кнопка «Присоединиться»), запись
 * созвона (плеер/«формируется»/«недоступно»), итоги встречи и — ТОЛЬКО админу —
 * транскрипт и кнопку «Отменить встречу».
 *
 * Статусы записи/итогов/транскрипта обрабатываются единым resolveProcessingKind
 * (как на странице урока): «формируется» — дружелюбный синий, КРАСНОЕ — только при
 * реальном сбое (failed), долгое отсутствие — нейтральное «недоступно».
 */
export function MeetingDetail({
  meetingId,
  isAdmin,
  backHref,
}: {
  meetingId: string;
  /** true — преподаватель/админ: видит транскрипт и может отменить встречу. */
  isAdmin: boolean;
  backHref: string;
}) {
  const { accessToken } = useAuth();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const fetchMeeting = useCallback(async () => {
    if (!accessToken || !meetingId) return;
    setLoading(true);
    try {
      const data = await getMeeting(accessToken, meetingId);
      setMeeting(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить встречу');
    } finally {
      setLoading(false);
    }
  }, [accessToken, meetingId]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  const handleCancel = async () => {
    if (!accessToken || !meeting) return;
    setCancelling(true);
    try {
      const updated = await cancelMeeting(accessToken, meeting.id);
      setMeeting(updated);
      toast.success('Встреча отменена');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось отменить встречу');
    } finally {
      setCancelling(false);
    }
  };

  const title = meeting?.title?.trim() || MEETING_FALLBACK_TITLE;
  const dateLabel = meeting?.date
    ? parseLocalDate(meeting.date).toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : null;
  const canJoin =
    meeting?.status === 'planned' && Boolean(meeting?.meetingUrl);

  // Запись созвона: приоритетно подписанный S3-URL (recordingFileUrl) по videoKey,
  // фолбэк — внешняя ссылка videoUrl. Подписанный S3-URL — всегда прямой файл
  // (embed-парсинг применяем ТОЛЬКО к внешней videoUrl: YouTube/Vimeo и т.п.).
  const recordingFileUrl = meeting?.recordingFileUrl ?? null;
  const recordingUrl = recordingFileUrl ?? meeting?.videoUrl ?? null;
  const recordingEmbed = recordingFileUrl ? null : recordingUrl ? parseVideoEmbed(recordingUrl) : null;
  const recKind = resolveProcessingKind({
    status: meeting?.recordingStatus,
    hasData: !!recordingUrl,
    requestedAt: meeting?.recordingRequestedAt,
    staleAfterMs: RECORDING_STALE_AFTER_MS,
  });
  const recordingPending = !recordingUrl && (recKind === 'processing' || recKind === 'ready');
  const recordingStale = !recordingUrl && recKind === 'stale';
  const recordingUnavailable =
    !recordingUrl && meeting?.status === 'done' && recKind === 'failed';
  const showRecordingSection =
    meeting?.status !== 'cancelled' &&
    (!!recordingUrl || recordingPending || recordingStale || recordingUnavailable);

  return (
    <div className="flex flex-col gap-6">
      <BackButton fallbackHref={backHref}>К расписанию</BackButton>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col items-start gap-2">
            {error}
            <Button variant="outline" size="sm" onClick={fetchMeeting}>
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : !meeting ? (
        !error && <p className="text-sm text-muted-foreground">Встреча не найдена.</p>
      ) : (
        <>
          {/* Шапка */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Встреча знает planned/done/cancelled — все валидны как LessonStatus. */}
              <LessonStatusBadge status={meeting.status as LessonStatus} />
              <Badge>1-на-1</Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>

            <p className="text-sm text-muted-foreground">
              {isAdmin ? 'Студент: ' : 'Преподаватель: '}
              <span className="font-medium text-foreground">
                {isAdmin ? meeting.student.name : meeting.teacher.name}
              </span>
            </p>

            {dateLabel && (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm',
                  meeting.status === 'planned' ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <Calendar className="size-4 shrink-0" aria-hidden="true" />
                {meeting.status === 'done' ? (
                  <span>Встреча прошла {dateLabel}</span>
                ) : meeting.status === 'cancelled' ? (
                  <span className="line-through">{dateLabel}</span>
                ) : (
                  <>
                    <span>{dateLabel}</span>
                    {meeting.startTime && (
                      <>
                        <span aria-hidden="true">·</span>
                        <Clock className="size-4 shrink-0" aria-hidden="true" />
                        <span className="font-mono">{meeting.startTime}</span>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-2">
              {canJoin && (
                <Button asChild className="min-h-11 w-full sm:w-fit">
                  <a href={meeting.meetingUrl!} target="_blank" rel="noopener noreferrer">
                    <Video aria-hidden="true" />
                    Присоединиться к встрече
                  </a>
                </Button>
              )}
              {/* Отмена — только админ-преподаватель, только для запланированной встречи. */}
              {isAdmin && meeting.status === 'planned' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={cancelling} className="min-h-11">
                      {cancelling ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <XCircle aria-hidden="true" />
                      )}
                      Отменить встречу
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Отменить встречу?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Встреча будет отменена, а связанный созвон Zoom — удалён.
                        Студент увидит её как отменённую.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Закрыть</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleCancel}>
                        Отменить встречу
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {/* Запись встречи */}
          {showRecordingSection && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Video className="size-5 shrink-0 text-muted-foreground" />
                  Запись встречи
                </CardTitle>
                <p className="text-sm text-muted-foreground">Запись прошедшего созвона</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {recordingUrl ? (
                  recordingEmbed ? (
                    <VideoEmbedFrame src={recordingEmbed} title={`Запись встречи — ${title}`} />
                  ) : (
                    <VideoFileFrame src={recordingUrl} label={`Запись встречи — ${title}`} />
                  )
                ) : recordingPending ? (
                  <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
                    <Loader2 className="size-5 shrink-0 animate-spin" />
                    <span>Формируется запись встречи — появится здесь. Зайдите позже.</span>
                  </div>
                ) : recordingStale ? (
                  <div className="flex items-center gap-3 rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                    <Clock className="size-5 shrink-0" />
                    <span>Запись встречи пока недоступна.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    <Video className="size-5 shrink-0" />
                    <span>Запись встречи не получена.</span>
                    {/* recordingError виден только админу (студенту бэк его не отдаёт). */}
                    {isAdmin && meeting.recordingError?.trim() && (
                      <span className="text-xs">({meeting.recordingError.trim()})</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Итоги встречи */}
          {meeting.summary ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Итоги встречи</CardTitle>
                  <SummarySourceBadge source={meeting.summarySource} />
                </div>
              </CardHeader>
              <CardContent>
                <MarkdownContent content={meeting.summary} />
              </CardContent>
            </Card>
          ) : (
            (() => {
              const kind = resolveProcessingKind({
                status: meeting.summaryStatus,
                hasData: false,
                requestedAt: meeting.summaryRequestedAt,
                staleAfterMs: SUMMARY_STALE_AFTER_MS,
              });
              if (kind === 'empty' || kind === 'ready') return null;
              return (
                <Card>
                  <CardHeader>
                    <CardTitle>Итоги встречи</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {kind === 'processing' ? (
                      <div className="flex flex-col gap-2">
                        <p className="flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-300">
                          <Loader2 className="size-3.5 animate-spin" />
                          Формируются итоги встречи — Zoom обычно готовит их за несколько
                          минут. Зайдите позже.
                        </p>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ) : kind === 'failed' ? (
                      <p className="text-sm text-destructive">
                        Не удалось сформировать итоги этой встречи.
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Итоги по этой встрече пока недоступны.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })()
          )}

          {/* Транскрипт — ТОЛЬКО админ/преподаватель (студенту бэк поля не отдаёт). */}
          {isAdmin && meeting.transcriptStatus !== undefined && (
            <MeetingTranscriptCard meeting={meeting} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Карточка транскрипта встречи (только преподаватель). Тело не тянем заранее —
 * подписанную ссылку подгружаем по клику «Открыть/Скачать» (зеркало блока
 * транскрипта занятия). Состояния — единый resolveProcessingKind.
 */
function MeetingTranscriptCard({ meeting }: { meeting: Meeting }) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState<'open' | 'vtt' | 'txt' | null>(null);

  const kind = resolveProcessingKind({
    status: meeting.transcriptStatus,
    requestedAt: meeting.transcriptRequestedAt,
    staleAfterMs: TRANSCRIPT_STALE_AFTER_MS,
  });

  const open = useCallback(
    async (action: 'open' | 'vtt' | 'txt') => {
      if (!accessToken || busy) return;
      setBusy(action);
      try {
        const format = action === 'open' ? 'txt' : action;
        const { url } = await getMeetingTranscript(accessToken, meeting.id, format);
        if (action === 'open') {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          window.location.href = fileDownloadUrl(url);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось получить транскрипт');
      } finally {
        setBusy(null);
      }
    },
    [accessToken, meeting.id, busy],
  );

  // none / нет интеграции Zoom — карточку не показываем (без пустого блока).
  if (kind === 'empty') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-5 shrink-0 text-muted-foreground" />
          Транскрипт встречи
        </CardTitle>
        <p className="text-sm text-muted-foreground">Дословная расшифровка — только вам</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {kind === 'processing' ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-300">
              <Loader2 className="size-3.5 animate-spin" />
              Формируется транскрипт встречи — он приходит из Zoom позже записи.
              Загляните позже.
            </p>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : kind === 'stale' ? (
          <p className="text-sm text-muted-foreground">
            Транскрипт по этой встрече пока недоступен.
          </p>
        ) : kind === 'failed' ? (
          <p className="text-sm text-destructive">
            {meeting.transcriptError?.trim() ||
              'Не удалось получить транскрипт встречи из Zoom.'}
          </p>
        ) : (
          // ready
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => open('open')}
              disabled={!!busy}
              className="min-h-9"
            >
              {busy === 'open' ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
              Открыть
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => open('vtt')}
              disabled={!!busy}
              className="min-h-9"
            >
              {busy === 'vtt' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Скачать .vtt
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => open('txt')}
              disabled={!!busy}
              className="min-h-9"
            >
              {busy === 'txt' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Скачать .txt
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
