'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ScrollText,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@platform/ui/lib/utils';
import { useAuth } from '@/lib/auth-context';
import {
  cancelMeeting,
  fileDownloadUrl,
  getMeeting,
  getMeetingTranscript,
  refreshMeetingFromZoom,
  retryMeetingRecording,
  updateMeetingStatus,
  type Meeting,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { MeetingStatusControl } from '@/components/meetings/meeting-status-control';

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
  // Смена статуса (Начать/Провести) и подтяжка из Zoom — действия владельца-препода.
  const [statusPending, setStatusPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);

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

  // Смена статуса встречи (Начать planned→live / Провести planned|live→done).
  // После успеха рефетчим встречу: от «Проведена» зависит подтяжка записи/итогов.
  const handleStatus = useCallback(
    async (next: 'live' | 'done') => {
      if (!accessToken || !meeting || statusPending) return;
      setStatusPending(true);
      try {
        const updated = await updateMeetingStatus(accessToken, meeting.id, next);
        setMeeting(updated);
        toast.success(next === 'done' ? 'Встреча проведена' : 'Встреча начата');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось изменить статус');
      } finally {
        setStatusPending(false);
      }
    },
    [accessToken, meeting, statusPending],
  );

  // Ручная подтяжка записи/итогов/транскрипта из Zoom (синхронно). Полезна, когда
  // автосбор по вебхуку завис/не сработал. Возвращает обновлённую встречу.
  const handleRefresh = useCallback(async () => {
    if (!accessToken || !meeting || refreshing) return;
    setRefreshing(true);
    try {
      const updated = await refreshMeetingFromZoom(accessToken, meeting.id);
      setMeeting(updated);
      toast.success('Обновили данные встречи из Zoom');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось обновить из Zoom');
    } finally {
      setRefreshing(false);
    }
  }, [accessToken, meeting, refreshing]);

  // Повторить автозагрузку записи Zoom, когда recordingStatus = 'failed'/завис.
  const handleRetryRecording = useCallback(async () => {
    if (!accessToken || !meeting || retrying) return;
    setRetrying(true);
    try {
      const updated = await retryMeetingRecording(accessToken, meeting.id);
      setMeeting(updated);
      toast.success('Перезапустили загрузку записи');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось перезапустить загрузку');
    } finally {
      setRetrying(false);
    }
  }, [accessToken, meeting, retrying]);

  const title = meeting?.title?.trim() || MEETING_FALLBACK_TITLE;
  const dateLabel = meeting?.date
    ? parseLocalDate(meeting.date).toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : null;
  // Присоединиться можно к запланированной И к идущей встрече ('live' выставляет
  // бэк по вебхуку Zoom meeting.started) — кнопка не должна пропадать на старте.
  const canJoin =
    (meeting?.status === 'planned' || meeting?.status === 'live') &&
    Boolean(meeting?.meetingUrl);

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
  // Признак реальной ошибки записи — для кнопки «Повторить» (как у занятия).
  const recordingFailed = !recordingUrl && recKind === 'failed';
  // Админу показываем секцию записи и для проведённой/идущей встречи без данных —
  // чтобы был доступ к «Обновить из Zoom» (подтянуть запись/итоги/транскрипт вручную).
  const adminCanRefresh =
    isAdmin && (meeting?.status === 'done' || meeting?.status === 'live');
  const showRecordingSection =
    meeting?.status !== 'cancelled' &&
    (!!recordingUrl || recordingPending || recordingStale || recordingFailed ||
      adminCanRefresh);

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
              {/* Встреча знает planned/live/done/cancelled — все валидны как LessonStatus. */}
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
                  meeting.status === 'planned' || meeting.status === 'live'
                    ? 'text-foreground'
                    : 'text-muted-foreground',
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

            {/* Блок действий — зеркало карточки занятия (lesson-view): управление
                статусом живёт в едином контроле (бейдж-дропдаун + одна primary-
                кнопка «Провести»), а «Присоединиться» — вторичное действие
                (secondary). Так нет двух конкурирующих чёрных кнопок: иерархия
                чёткая и «функции выглядят одинаково» с занятием. */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {/* Управление встречей (Начать / Провести / Отменить + откаты не
                  предусмотрены) — только владелец-препод. От «Проведена» зависит
                  подтяжка записи/итогов/транскрипта. Студенту контрол не показываем
                  (внутри сам прячется для done/cancelled). */}
              {isAdmin && (
                <MeetingStatusControl
                  status={meeting.status}
                  pending={statusPending || cancelling}
                  onStatus={(next) => void handleStatus(next)}
                  onCancel={handleCancel}
                />
              )}
              {/* Присоединиться к запланированной/идущей встрече — вторичное
                  действие (secondary), как «Присоединиться к созвону» у занятия. */}
              {canJoin && (
                <Button
                  asChild
                  variant="secondary"
                  className="min-h-9 w-full sm:w-fit"
                >
                  <a href={meeting.meetingUrl!} target="_blank" rel="noopener noreferrer">
                    <Video className="size-4" aria-hidden="true" />
                    {meeting.status === 'live'
                      ? 'Присоединиться — встреча идёт'
                      : 'Присоединиться к встрече'}
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </a>
                </Button>
              )}
            </div>
          </div>

          {/* Запись встречи */}
          {showRecordingSection && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-1.5">
                    <CardTitle className="flex items-center gap-2">
                      <Video className="size-5 shrink-0 text-muted-foreground" />
                      Запись встречи
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">Запись прошедшего созвона</p>
                  </div>
                  {/* Ручная подтяжка из Zoom (запись/итоги/транскрипт). Только владелец-
                      препод — полезна, когда автосбор по вебхуку завис/не сработал. */}
                  {adminCanRefresh && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={refreshing}
                      className="min-h-9"
                    >
                      {refreshing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Обновить из Zoom
                    </Button>
                  )}
                </div>
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
                ) : recordingFailed ? (
                  <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    <div className="flex items-center gap-3">
                      <Video className="size-5 shrink-0" />
                      <span>Запись встречи не получена.</span>
                      {/* recordingError виден только админу (студенту бэк его не отдаёт). */}
                      {isAdmin && meeting.recordingError?.trim() && (
                        <span className="text-xs">({meeting.recordingError.trim()})</span>
                      )}
                    </div>
                    {/* Повторить автозагрузку записи — только владелец-препод. */}
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetryRecording}
                        disabled={retrying}
                        className="min-h-9 w-fit"
                      >
                        {retrying ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        Повторить
                      </Button>
                    )}
                  </div>
                ) : (
                  // Встреча проведена/идёт, но запись ещё не пришла (recKind none/ready
                  // без файла). Нейтральная подсказка + «Обновить из Zoom» в шапке.
                  <div className="flex items-center gap-3 rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                    <Clock className="size-5 shrink-0" />
                    <span>Запись пока не подтянута. Обновите из Zoom или зайдите позже.</span>
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
