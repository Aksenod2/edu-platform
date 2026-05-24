'use client';

import { useEffect, useState, useCallback } from 'react';
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
  const { accessToken } = useAuth();
  const params = useParams();
  const lessonId = params.id as string;

  const [lesson, setLesson] = useState<LessonWithAssignments | null>(null);
  const [prev, setPrev] = useState<Lesson | null>(null);
  const [next, setNext] = useState<Lesson | null>(null);
  // Карта assignmentId → studentAssignmentId (детальная страница задания
  // ищет по id студенческого назначения, а не самого задания).
  const [saByAssignment, setSaByAssignment] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLesson = useCallback(async () => {
    if (!accessToken || !lessonId) return;
    setLoading(true);
    try {
      const { lesson: data } = await getLesson(accessToken, lessonId);
      setLesson(data);
      setError('');

      // Соседние уроки потока для навигации prev/next
      try {
        const { lessons } = await getLessons(accessToken, data.streamId);
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
          const { studentAssignments } = await getStudentAssignments(accessToken, {
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
  }, [accessToken, lessonId]);

  useEffect(() => {
    fetchLesson();
  }, [fetchLesson]);

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
  // Запись ещё обрабатывается (Zoom едет) — обещаем студенту, что появится.
  // [М-2] статус 'ready', но медиа нет (URL не подписался) — тоже «готовится»,
  // секцию не прячем: запись по факту есть, просто временный URL не пришёл.
  const recordingPending =
    !hasRecordingMedia &&
    ['pending', 'processing', 'ready'].includes(lesson?.recordingStatus ?? '');
  // Запись не получилась (Zoom вернул ошибку) — честно говорим «недоступна».
  // Статус 'none' у проведённого занятия НЕ считаем недоступностью: Zoom ещё может
  // прислать запись (бэк ставит 'pending' на meeting.ended), поэтому секцию не показываем.
  const recordingUnavailable =
    !hasRecordingMedia &&
    !recordingPending &&
    lesson?.status === 'done' &&
    lesson?.recordingStatus === 'failed';
  // Показываем секцию записи, только если есть что показать (медиа/ожидание/недоступность).
  // Если занятие ещё не проведено и записи нет — секцию не показываем (не обещаем пустоту).
  // [М-3] у отменённого занятия записи быть не может — секцию не показываем вовсе.
  const showRecordingSection =
    lesson?.status !== 'cancelled' &&
    (hasRecordingMedia || recordingPending || recordingUnavailable);

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
                          <VideoFileFrame src={video.url} label={video.title ?? lesson.title} />
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
                  <div className="flex items-center gap-3 rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                    <Clock className="size-5 shrink-0" />
                    <span>Запись занятия готовится, появится здесь.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                    <Video className="size-5 shrink-0" />
                    <span>Запись занятия недоступна.</span>
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
            (lesson.summaryStatus === 'pending' ||
              lesson.summaryStatus === 'processing' ||
              lesson.summaryStatus === 'failed') && (
              <Card>
                <CardHeader>
                  <CardTitle>Итоги занятия</CardTitle>
                </CardHeader>
                <CardContent>
                  {lesson.summaryStatus === 'processing' ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-muted-foreground">
                        Zoom формирует итоги занятия — обычно это занимает несколько минут.
                      </p>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-11/12" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ) : lesson.summaryStatus === 'failed' ? (
                    <p className="text-sm text-muted-foreground">
                      Итоги по этому занятию пока недоступны.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Занятие завершилось — итоги появятся здесь, как только Zoom их сформирует.
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          )}

          {/* Материалы урока (PDF/MD) */}
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
                <Button variant="outline" asChild>
                  <Link href={`/dashboard/lessons/${prev.id}`}>
                    <ArrowLeft />
                    <span className="max-w-[12rem] truncate">{prev.title}</span>
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {next ? (
                <Button variant="outline" asChild>
                  <Link href={`/dashboard/lessons/${next.id}`}>
                    <span className="max-w-[12rem] truncate">{next.title}</span>
                    <ArrowRight />
                  </Link>
                </Button>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
