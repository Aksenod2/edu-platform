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
  type MeetingRefreshResult,
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
import { RecordingStatusBadge } from '@/components/schedule/recording-status-badge';
import {
  recordingStatusHint,
  summaryProcessingHint,
  summaryStaleHint,
  summaryFailedHint,
  transcriptProcessingHint,
  transcriptStaleHint,
  transcriptFailedHint,
} from '@/components/schedule/processing-status-labels';
import { parseLocalDate } from '@/components/schedule/utils';
import { parseVideoEmbed } from '@/lib/video-embed';
import { MEETING_FALLBACK_TITLE } from '@/components/meetings/utils';
import { MeetingStatusControl } from '@/components/meetings/meeting-status-control';

// Метки шагов единой подтяжки встречи из Zoom для тоста по частичному результату.
// Зеркало ZOOM_REFRESH_LABELS занятия, но БЕЗ посещаемости (у встречи её нет by-design).
// ВРЕМЕННО (диагностика #188) — удалить после: 'recordingDebug' тоже исключён из меток
// шагов (это не шаг подтяжки, а отдельное диагностическое поле строки).
const MEETING_REFRESH_LABELS: Record<
  Exclude<keyof MeetingRefreshResult, 'meeting' | 'recordingDebug'>,
  string
> = {
  recording: 'Запись',
  summary: 'Итоги',
  transcript: 'Транскрипт',
};

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
  // автосбор по вебхуку завис/не сработал. Карточку обновляем по meeting из ответа,
  // а тост собираем по ЧАСТИЧНОМУ результату (что подтянулось / что ещё формируется /
  // что не получилось — с причиной), как у группового занятия (но без посещаемости).
  const handleRefresh = useCallback(async () => {
    if (!accessToken || !meeting || refreshing) return;
    setRefreshing(true);
    try {
      const result = await refreshMeetingFromZoom(accessToken, meeting.id);
      setMeeting(result.meeting);
      // «Ещё формируется» — НЕ ошибка: бэк присылает reason про формирование. Такой шаг
      // показываем нейтрально (…), а реальные сбои — с причиной.
      const isPending = (reason?: string | null) =>
        !!reason && /формир|ещё формируется|готов/i.test(reason);
      const keys = Object.keys(MEETING_REFRESH_LABELS) as (keyof typeof MEETING_REFRESH_LABELS)[];
      const parts = keys.map((key) => {
        const step = result[key];
        const label = MEETING_REFRESH_LABELS[key];
        if (step?.ok) return `${label} ✓`;
        if (isPending(step?.reason)) return `${label} — формируется…`;
        return `${label} — ${step?.reason?.trim() || 'не получено'}`;
      });
      // Реальная ошибка = шаг не ok и причина НЕ про формирование.
      const hasRealError = keys.some(
        (key) => !result[key]?.ok && !isPending(result[key]?.reason),
      );
      let message = parts.join(', ');
      // ВРЕМЕННО (диагностика #188) — удалить после. Дописываем безопасный отчёт о
      // том, что вернул Zoom на листинг записей, чтобы заказчик мог скопировать и прислать.
      if (result.recordingDebug) {
        message = `${message}\n\n${result.recordingDebug}`;
      }
      // Всё ok или «формируется» — это не ошибка (success), иначе предупреждение.
      // ВРЕМЕННО (диагностика #188): duration увеличена, чтобы успеть скопировать отчёт.
      const toastOpts = result.recordingDebug ? { duration: 60000 } : undefined;
      if (hasRealError) toast.warning(message, toastOpts);
      else toast.success(message, toastOpts);
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
              {/* Бейдж типа встречи — всегда. */}
              <Badge variant="secondary">1-на-1</Badge>
              {/* Статус в шапке read-only показываем, когда кликабельного
                  MeetingStatusControl нет: для терминальных встреч (done/cancelled,
                  где контрол не рендерится) ИЛИ для студента (контрол только у
                  админа). Иначе (админ + активная встреча planned/live) статус
                  живёт в едином кликабельном бейдже-дропдауне в блоке действий —
                  здесь его НЕ дублируем. Встреча знает planned/live/done/cancelled —
                  все валидны как LessonStatus. */}
              {(!isAdmin ||
                meeting.status === 'done' ||
                meeting.status === 'cancelled') && (
                <LessonStatusBadge status={meeting.status as LessonStatus} />
              )}
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
                  meeting={meeting}
                  pending={statusPending || cancelling}
                  onStatus={(next) => void handleStatus(next)}
                  onCancel={handleCancel}
                  onRescheduled={(updated) => setMeeting(updated)}
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
                ) : recKind === 'processing' || recKind === 'stale' || recKind === 'failed' ? (
                  // Единый инфоблок состояния записи — как у занятия (lesson-view):
                  // цветной RecordingStatusBadge (с AlertTriangle при ошибке) + подпись
                  // из общего источника. При failed добавляем «Повторить» прямо у ошибки.
                  <div
                    className={cn(
                      'flex flex-col gap-2 rounded-md border p-3',
                      recKind === 'processing' && 'border-blue-500/30 bg-blue-500/10',
                      recKind === 'failed' && 'border-destructive/40 bg-destructive/5',
                      recKind === 'stale' && 'bg-muted/50',
                    )}
                  >
                    <RecordingStatusBadge
                      status={meeting.recordingStatus}
                      // recordingError виден только админу (студенту бэк его не отдаёт).
                      error={isAdmin ? meeting.recordingError : undefined}
                      requestedAt={meeting.recordingRequestedAt}
                      className="w-fit"
                    />
                    <p
                      className={cn(
                        'text-xs',
                        recKind === 'processing'
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-muted-foreground',
                      )}
                    >
                      {recordingStatusHint(
                        recKind,
                        'встречи',
                        isAdmin ? meeting.recordingError : undefined,
                      )}
                    </p>
                    {/* Повторить автозагрузку записи при сбое — только владелец-препод. */}
                    {recKind === 'failed' && isAdmin && (
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
                          {summaryProcessingHint('встречи')}
                        </p>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ) : kind === 'failed' ? (
                      // Реальная ошибка — с кнопкой «подтянуть» прямо у ошибки (как у
                      // занятия), чтобы не уходить за общей кнопкой в шапке.
                      <div className="flex flex-col items-start gap-2">
                        <p className="text-sm text-destructive">
                          {summaryFailedHint('встречи')}
                        </p>
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
                            Подтянуть итоги
                          </Button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {summaryStaleHint('встречи')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })()
          )}

          {/* Транскрипт — ТОЛЬКО админ/преподаватель (студенту бэк поля не отдаёт). */}
          {isAdmin && meeting.transcriptStatus !== undefined && (
            <MeetingTranscriptCard
              meeting={meeting}
              canRefresh={adminCanRefresh}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
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
function MeetingTranscriptCard({
  meeting,
  canRefresh,
  refreshing,
  onRefresh,
}: {
  meeting: Meeting;
  /** Можно ли вручную подтянуть из Zoom (владелец-препод, встреча проведена/идёт). */
  canRefresh: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
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
              {transcriptProcessingHint('встречи')}
            </p>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : kind === 'stale' ? (
          <p className="text-sm text-muted-foreground">
            {transcriptStaleHint('встречи')}
          </p>
        ) : kind === 'failed' ? (
          // Реальная ошибка — с кнопкой «подтянуть» прямо у ошибки (как у занятия).
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-destructive">
              {transcriptFailedHint('встречи', meeting.transcriptError)}
            </p>
            {canRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={refreshing}
                className="min-h-9"
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Подтянуть транскрипт
              </Button>
            )}
          </div>
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
