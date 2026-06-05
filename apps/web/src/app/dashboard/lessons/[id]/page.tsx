'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  ClipboardList,
  Clock,
  Calendar,
  GraduationCap,
  Video,
} from 'lucide-react';
import { BackButton } from '@/components/back-button';
import { useAuth } from '@/lib/auth-context';
import {
  getLesson,
  getLessons,
  getStudentAssignments,
  type Lesson,
  type Assignment,
  type StudentAssignment,
} from '@/lib/api';
import {
  canJoinMeeting,
  parseLocalDate,
} from '@/components/schedule/utils';
import { LessonStatusBadge } from '@/components/schedule/lesson-status-badge';
import {
  resolveProcessingKind,
  RECORDING_STALE_AFTER_MS,
  SUMMARY_STALE_AFTER_MS,
} from '@/components/schedule/processing-status';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialRow } from '@/components/material-row';
import { SummarySourceBadge } from '@/components/schedule/lesson-summary';
import { VideoEmbedFrame, VideoFileFrame } from '@/components/lessons/video-frame';
import { parseVideoEmbed } from '@/lib/video-embed';

type LessonWithAssignments = Lesson & { assignments?: Assignment[] };

export default function StudentLessonPage() {
  const { accessToken, user } = useAuth();
  const params = useParams();
  const lessonId = params.id as string;

  // Актуальный токен держим в ref и используем его внутри загрузки урока, но НЕ
  // перезапускаем загрузку при «тихом» обновлении токена (авто-refresh на 401
  // примерно каждые 15 мин — TTL access-токена). Иначе getLesson отдавал бы
  // ЗАНОВО подписанные ссылки на видео (новые exp/sig), у <video> менялся бы src
  // и браузер перезагружал запись с нуля — студент терял место в записи занятия.
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const [lesson, setLesson] = useState<LessonWithAssignments | null>(null);
  const [prev, setPrev] = useState<Lesson | null>(null);
  const [next, setNext] = useState<Lesson | null>(null);
  // Карта assignmentId → studentAssignmentId (детальная страница задания
  // ищет по id студенческого назначения, а не самого задания).
  const [saByAssignment, setSaByAssignment] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLesson = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token || !lessonId) return;
    setLoading(true);
    try {
      const { lesson: data } = await getLesson(token, lessonId);
      setLesson(data);
      setError('');

      // Соседние уроки потока для навигации prev/next
      try {
        const { lessons } = await getLessons(token, data.streamId);
        const sorted = [...lessons].sort((a, b) => a.sortOrder - b.sortOrder);
        const idx = sorted.findIndex((l) => l.id === data.id);
        setPrev(idx > 0 ? sorted[idx - 1] : null);
        setNext(idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null);
      } catch {
        setPrev(null);
        setNext(null);
      }

      // Сопоставляем задания урока с назначениями текущего студента,
      // чтобы ссылка вела на корректную детальную страницу.
      if (data.assignments && data.assignments.length > 0) {
        try {
          const { studentAssignments } = await getStudentAssignments(token, {
            streamId: data.streamId,
          });
          const map: Record<string, string> = {};
          for (const sa of studentAssignments as StudentAssignment[]) {
            if (!(sa.assignmentId in map)) map[sa.assignmentId] = sa.id;
          }
          setSaByAssignment(map);
        } catch {
          setSaByAssignment({});
        }
      } else {
        setSaByAssignment({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки урока');
    } finally {
      setLoading(false);
    }
    // Зависимость только от lessonId: при «тихом» обновлении токена ссылку на
    // функцию не пересоздаём, поэтому эффект ниже не перезапускает загрузку.
  }, [lessonId]);

  // Грузим урок при смене урока или при ПЕРВОМ появлении токена (hasToken: false
  // → true один раз). Последующие обновления значения токена (refresh) hasToken
  // не меняют → перезагрузки урока (и сброса видео) не происходит.
  const hasToken = Boolean(accessToken);
  useEffect(() => {
    if (!hasToken) return;
    fetchLesson();
  }, [fetchLesson, hasToken]);

  const embedUrl = lesson?.videoUrl ? parseVideoEmbed(lesson.videoUrl) : null;
  // Показываем только задания, назначенные этому студенту (есть studentAssignment).
  const assignments = (lesson?.assignments ?? []).filter((a) => saByAssignment[a.id]);

  // Дата занятия как в «Расписании»: parseLocalDate (без UTC-сдвига), без года.
  const lessonDateLabel = lesson?.date
    ? parseLocalDate(lesson.date).toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : null;

  // Учебное видео урока (лекция, грузится ДО урока) — строго из блока урока.
  const hasLessonVideo = !!(
    (lesson?.videos && lesson.videos.length > 0) ||
    lesson?.videoFileUrl ||
    lesson?.videoUrl
  );

  // Запись занятия (запись Zoom-созвона, подтягивается ПОСЛЕ занятия) — отдельные поля.
  const hasRecordingMedia = !!(lesson?.recordingFileUrl || lesson?.recordingVideoUrl);
  const recordingEmbedUrl = lesson?.recordingVideoUrl
    ? parseVideoEmbed(lesson.recordingVideoUrl)
    : null;
  // Единый «вид» состояния записи: формируется (синий) / недоступно (серое) /
  // ошибка (красный) / готово / нет. КРАСНОЕ — только при реальном сбое (failed).
  // [М-2] статус 'ready', но медиа нет (URL не подписался) → resolver вернёт 'ready'
  // (запись по факту есть) — секцию не прячем; ниже это попадёт в ветку «недоступна»
  // без медиа, поэтому ready-без-медиа трактуем как «формируется» (URL ещё едет).
  const recKind = resolveProcessingKind({
    status: lesson?.recordingStatus,
    hasData: hasRecordingMedia,
    requestedAt: lesson?.recordingRequestedAt,
    staleAfterMs: RECORDING_STALE_AFTER_MS,
  });
  // ready без медиа (временный URL не пришёл) — для студента это «формируется».
  const recordingPending =
    !hasRecordingMedia && (recKind === 'processing' || recKind === 'ready');
  const recordingStale = !hasRecordingMedia && recKind === 'stale';
  // Запись не получилась (реальный сбой Zoom) — честно говорим «не получена».
  // Статус 'none' у проведённого занятия НЕ считаем недоступностью: Zoom ещё может
  // прислать запись (бэк ставит 'processing' на meeting.ended), поэтому секцию не показываем.
  const recordingUnavailable =
    !hasRecordingMedia && lesson?.status === 'done' && recKind === 'failed';
  // Показываем секцию записи, только если есть что показать (медиа/ожидание/недоступность).
  // Если занятие ещё не проведено и записи нет — секцию не показываем (не обещаем пустоту).
  // [М-3] у отменённого занятия записи быть не может — секцию не показываем вовсе.
  const showRecordingSection =
    lesson?.status !== 'cancelled' &&
    (hasRecordingMedia || recordingPending || recordingStale || recordingUnavailable);

  return (
    <div className="flex flex-col gap-6">
      <BackButton fallbackHref="/dashboard/lessons">К урокам</BackButton>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : !lesson ? (
        !error && (
          <p className="text-sm text-muted-foreground">Урок не найден.</p>
        )
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <LessonStatusBadge status={lesson.status} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{lesson.title}</h1>

            {/* Дата и время занятия. Показываем только если дата назначена
                (бэк подбирает Session потока). Время — как есть, font-mono.
                Для прошедшего/отменённого занятия — приглушённо. */}
            {lessonDateLabel && (
              <div
                className={
                  'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ' +
                  (lesson.status === 'planned'
                    ? 'text-foreground'
                    : 'text-muted-foreground')
                }
              >
                <Calendar className="size-4 shrink-0" aria-hidden="true" />
                {lesson.status === 'done' ? (
                  <span>Занятие прошло {lessonDateLabel}</span>
                ) : lesson.status === 'cancelled' ? (
                  <span className="line-through">{lessonDateLabel}</span>
                ) : (
                  <>
                    <span>{lessonDateLabel}</span>
                    {lesson.startTime && (
                      <>
                        <span aria-hidden="true">·</span>
                        <Clock className="size-4 shrink-0" aria-hidden="true" />
                        <span className="font-mono">{lesson.startTime}</span>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Присоединиться к созвону — только для запланированного занятия со
                ссылкой (canJoinMeeting). На мобилке кнопка во всю ширину. */}
            {canJoinMeeting(lesson) && (
              <Button asChild className="mt-1 min-h-11 w-full sm:w-fit">
                <a
                  href={lesson.meetingUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Video aria-hidden="true" />
                  Присоединиться к занятию
                </a>
              </Button>
            )}
          </div>

          {/* Учебное видео урока (лекция, грузится ДО урока). Если несколько —
              показываем список; иначе одиночное видео (файл или внешняя ссылка).
              Нет учебного видео — секцию не показываем (без пустого плеера). */}
          {hasLessonVideo && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="size-5 shrink-0 text-muted-foreground" />
                  Учебное видео урока
                </CardTitle>
                <p className="text-sm text-muted-foreground">Посмотрите до занятия</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {lesson.videos && lesson.videos.length > 0 ? (
                  lesson.videos.map((video) => {
                    const videoEmbed =
                      video.kind === 'link' ? parseVideoEmbed(video.url) : null;
                    return (
                      <div key={video.id} className="flex flex-col gap-2">
                        {video.title && (
                          <div className="text-sm font-medium">{video.title}</div>
                        )}
                        {video.kind === 'file' ? (
                          <VideoFileFrame
                            src={video.url}
                            label={video.title ?? lesson.title}
                            // Трекинг прогресса просмотра — только студенту, для нашего
                            // видеофайла урока, когда есть streamId и videoId. Запись
                            // занятия (Zoom) и внешние embed не трекаем.
                            track={
                              user?.role === 'student' && lesson.streamId
                                ? {
                                    lessonId: lesson.id,
                                    videoId: video.id,
                                    streamId: lesson.streamId,
                                  }
                                : undefined
                            }
                          />
                        ) : videoEmbed ? (
                          <VideoEmbedFrame src={videoEmbed} title={video.title ?? lesson.title} />
                        ) : (
                          <Button asChild className="w-fit">
                            <a href={video.url} target="_blank" rel="noopener noreferrer">
                              Смотреть видео
                              <ExternalLink />
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
                    <Button asChild className="w-fit">
                      <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer">
                        Смотреть видео
                        <ExternalLink />
                      </a>
                    </Button>
                  )
                )}
              </CardContent>
            </Card>
          )}

          {/* Запись занятия (запись Zoom-созвона, подтягивается ПОСЛЕ занятия).
              Показываем плеер записи / «готовится» / «недоступна» — см. showRecordingSection.
              Если занятие ещё не проведено и записи нет — секцию не рендерим. */}
          {showRecordingSection && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Video className="size-5 shrink-0 text-muted-foreground" />
                  Запись занятия
                </CardTitle>
                <p className="text-sm text-muted-foreground">Запись прошедшего созвона</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {hasRecordingMedia ? (
                  lesson.recordingFileUrl ? (
                    <VideoFileFrame
                      src={lesson.recordingFileUrl}
                      label={`Запись занятия — ${lesson.title}`}
                    />
                  ) : recordingEmbedUrl ? (
                    <VideoEmbedFrame
                      src={recordingEmbedUrl}
                      title={`Запись занятия — ${lesson.title}`}
                    />
                  ) : (
                    <Button asChild className="w-fit">
                      <a
                        href={lesson.recordingVideoUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Смотреть запись
                        <ExternalLink />
                      </a>
                    </Button>
                  )
                ) : recordingPending ? (
                  // Формируется — дружелюбный синий инфо (НЕ ошибка).
                  <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
                    <Loader2 className="size-5 shrink-0 animate-spin" />
                    <span>
                      Формируется запись конференции — появится здесь. Зайдите позже.
                    </span>
                  </div>
                ) : recordingStale ? (
                  // Данных давно нет — нейтральное серое «недоступно».
                  <div className="flex items-center gap-3 rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                    <Clock className="size-5 shrink-0" />
                    <span>Запись занятия пока недоступна.</span>
                  </div>
                ) : (
                  // Реальный сбой Zoom — единственное место с акцентом ошибки.
                  <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    <Video className="size-5 shrink-0" />
                    <span>Запись занятия не получена.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Итоги занятия. Если есть текст summary:
                - с источником (zoom_ai/manual) → блок-карточка с бейджем;
                - без источника (легаси/блочное описание) → прежний абзац.
              Если текста нет, но статус формирования итогов уже идёт
              (pending/processing/failed) → показываем состояние (без кнопок —
              ручную подтяжку студент не делает). status='none'/нет Zoom — ничего. */}
          {lesson.summary ? (
            lesson.summarySource ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>Итоги занятия</CardTitle>
                    <SummarySourceBadge source={lesson.summarySource} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                    {lesson.summary}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <p className="text-lg leading-relaxed text-muted-foreground">{lesson.summary}</p>
            )
          ) : (
            // Текста итогов нет — показываем состояние формирования. Единый «вид»:
            // формируется (синий) / недоступно (серое) / ошибка (красный). Ручную
            // подтяжку студент не делает (без кнопок). empty/ready — ничего не рендерим.
            (() => {
              const kind = resolveProcessingKind({
                status: lesson.summaryStatus,
                hasData: false,
                requestedAt: lesson.summaryRequestedAt,
                staleAfterMs: SUMMARY_STALE_AFTER_MS,
              });
              if (kind === 'empty' || kind === 'ready') return null;
              return (
                <Card>
                  <CardHeader>
                    <CardTitle>Итоги занятия</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {kind === 'processing' ? (
                      <div className="flex flex-col gap-2">
                        <p className="flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-300">
                          <Loader2 className="size-3.5 animate-spin" />
                          Формируются итоги занятия — Zoom обычно готовит их за несколько
                          минут. Зайдите позже.
                        </p>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-11/12" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ) : kind === 'failed' ? (
                      <p className="text-sm text-destructive">
                        Не удалось сформировать итоги этого занятия.
                      </p>
                    ) : (
                      // stale — данных давно нет.
                      <p className="text-sm text-muted-foreground">
                        Итоги по этому занятию пока недоступны.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })()
          )}

          {/* Материалы урока (PDF/MD) */}
          {lesson.materials && lesson.materials.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Материалы</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {lesson.materials.map((m) => (
                  <MaterialRow
                    key={m.s3Key}
                    material={m}
                    // Трекинг обращений к материалу — только студенту и при streamId
                    // (так же, как track у VideoFileFrame выше).
                    track={
                      user?.role === 'student' && lesson.streamId
                        ? {
                            accessToken: accessToken!,
                            lessonId: lesson.id,
                            streamId: lesson.streamId,
                          }
                        : undefined
                    }
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Задания урока */}
          {assignments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Задание урока</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {assignments.map((a) => (
                  <Link
                    key={a.id}
                    href={`/dashboard/assignments/${saByAssignment[a.id]}`}
                    className="no-underline"
                  >
                    <div className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent/50">
                      <ClipboardList className="size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{a.title}</div>
                        {a.dueDate && (
                          <div className="text-xs text-muted-foreground">
                            Дедлайн: {new Date(a.dueDate).toLocaleDateString('ru-RU')}
                          </div>
                        )}
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {!hasLessonVideo &&
            !showRecordingSection &&
            !lesson.summary &&
            (!lesson.materials || lesson.materials.length === 0) &&
            assignments.length === 0 && (
              <p className="text-sm italic text-muted-foreground">Контент пока не добавлен.</p>
            )}

          {/* Навигация prev/next */}
          {(prev || next) && (
            <div className="flex items-center justify-between gap-3 border-t pt-4">
              {prev ? (
                <Button variant="outline" asChild className="min-w-0 flex-1 justify-start">
                  <Link href={`/dashboard/lessons/${prev.id}`} className="min-w-0">
                    <ArrowLeft className="shrink-0" />
                    <span className="min-w-0 truncate">{prev.title}</span>
                  </Link>
                </Button>
              ) : (
                <span className="flex-1" />
              )}
              {next ? (
                <Button variant="outline" asChild className="min-w-0 flex-1 justify-end">
                  <Link href={`/dashboard/lessons/${next.id}`} className="min-w-0">
                    <span className="min-w-0 truncate">{next.title}</span>
                    <ArrowRight className="shrink-0" />
                  </Link>
                </Button>
              ) : (
                <span className="flex-1" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
