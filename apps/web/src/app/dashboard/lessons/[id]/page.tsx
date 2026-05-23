'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft, ArrowRight, ExternalLink, ClipboardList, Clock } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getLesson,
  getLessons,
  getStudentAssignments,
  LESSON_STATUS_LABELS,
  type Lesson,
  type LessonStatus,
  type Assignment,
  type StudentAssignment,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MaterialRow } from '@/components/material-row';
import { SummarySourceBadge } from '@/components/schedule/lesson-summary';
import { parseVideoEmbed } from '@/lib/video-embed';

type LessonWithAssignments = Lesson & { assignments?: Assignment[] };

const statusBadgeVariant: Record<LessonStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  planned: 'default',
  done: 'outline',
  cancelled: 'destructive',
};

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
  const recordingPending =
    !hasRecordingMedia &&
    (lesson?.recordingStatus === 'pending' || lesson?.recordingStatus === 'processing');
  // Проведённое занятие без записи и без ожидания — нейтрально «недоступна».
  const recordingUnavailable =
    !hasRecordingMedia &&
    !recordingPending &&
    lesson?.status === 'done' &&
    (lesson?.recordingStatus === 'failed' || lesson?.recordingStatus === 'none');
  // Показываем секцию записи, только если есть что показать (медиа/ожидание/недоступность).
  // Если занятие ещё не проведено и записи нет — секцию не показываем (не обещаем пустоту).
  const showRecordingSection = hasRecordingMedia || recordingPending || recordingUnavailable;

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="w-fit -ml-2" asChild>
        <Link href="/dashboard/lessons">
          <ArrowLeft />
          К урокам
        </Link>
      </Button>

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
              <Badge variant={statusBadgeVariant[lesson.status] ?? 'default'}>
                {LESSON_STATUS_LABELS[lesson.status] ?? lesson.status}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{lesson.title}</h1>
          </div>

          {/* Учебное видео урока (лекция, грузится ДО урока). Если несколько —
              показываем список; иначе одиночное видео (файл или внешняя ссылка).
              Нет учебного видео — секцию не показываем (без пустого плеера). */}
          {hasLessonVideo && (
            <Card>
              <CardHeader>
                <CardTitle>Учебное видео урока</CardTitle>
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
                          <div className="flex max-h-[70vh] justify-center overflow-hidden rounded-lg border bg-black">
                            <video
                              controls
                              preload="metadata"
                              controlsList="nodownload"
                              onContextMenu={(e) => e.preventDefault()}
                              className="max-h-[70vh] w-auto max-w-full"
                              src={video.url}
                            />
                          </div>
                        ) : videoEmbed ? (
                          <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
                            <iframe
                              src={videoEmbed}
                              title={video.title ?? lesson.title}
                              className="size-full"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          </div>
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
                  <div className="flex max-h-[70vh] justify-center overflow-hidden rounded-lg border bg-black">
                    <video
                      controls
                      preload="metadata"
                      controlsList="nodownload"
                      onContextMenu={(e) => e.preventDefault()}
                      className="max-h-[70vh] w-auto max-w-full"
                      src={lesson.videoFileUrl}
                    />
                  </div>
                ) : embedUrl ? (
                  <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
                    <iframe
                      src={embedUrl}
                      title={lesson.title}
                      className="size-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
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
                <CardTitle>Запись занятия</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {hasRecordingMedia ? (
                  lesson.recordingFileUrl ? (
                    <div className="flex max-h-[70vh] justify-center overflow-hidden rounded-lg border bg-black">
                      <video
                        controls
                        preload="metadata"
                        controlsList="nodownload"
                        onContextMenu={(e) => e.preventDefault()}
                        className="max-h-[70vh] w-auto max-w-full"
                        src={lesson.recordingFileUrl}
                      />
                    </div>
                  ) : recordingEmbedUrl ? (
                    <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
                      <iframe
                        src={recordingEmbedUrl}
                        title={`Запись занятия — ${lesson.title}`}
                        className="size-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
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
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Clock className="size-5 shrink-0" />
                    <span>Запись занятия готовится, появится здесь.</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Запись занятия недоступна.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Итоги занятия: если у summary есть источник (zoom_ai/manual) — это итоги
              конкретного занятия, показываем отдельным блоком с бейджем источника.
              Иначе (легаси/блочное описание без источника) — прежний абзац. */}
          {lesson.summary &&
            (lesson.summarySource ? (
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
            ))}

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
