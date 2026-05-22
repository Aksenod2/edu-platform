'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft, ArrowRight, ExternalLink, ClipboardList } from 'lucide-react';
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

type LessonWithAssignments = Lesson & { assignments?: Assignment[] };

/**
 * Преобразует ссылку YouTube/Vimeo в embed-URL.
 * Возвращает null, если ссылка не распознана.
 */
function parseVideoEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');

    // YouTube: youtu.be/<id>, youtube.com/watch?v=<id>, /embed/<id>, /shorts/<id>
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      const m = u.pathname.match(/^\/(embed|shorts)\/([^/?]+)/);
      if (m) return `https://www.youtube.com/embed/${m[2]}`;
    }

    // Vimeo: vimeo.com/<id>, player.vimeo.com/video/<id>
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === 'player.vimeo.com') {
      const m = u.pathname.match(/^\/video\/(\d+)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

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

          {/* Видео: приоритет — загруженный файл (встроенный плеер),
              иначе внешняя ссылка (embed YouTube/Vimeo или кнопка). */}
          {lesson.videoFileUrl ? (
            <div className="flex max-h-[70vh] justify-center overflow-hidden rounded-lg border bg-black">
              <video
                controls
                className="max-h-[70vh] w-auto max-w-full"
                src={lesson.videoFileUrl}
              />
            </div>
          ) : (
            lesson.videoUrl && (
              embedUrl ? (
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
                <Button asChild className="w-fit">
                  <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer">
                    Смотреть видео
                    <ExternalLink />
                  </a>
                </Button>
              )
            )
          )}

          {/* Краткое описание */}
          {lesson.summary && (
            <p className="text-lg leading-relaxed text-muted-foreground">{lesson.summary}</p>
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

          {!lesson.videoFileUrl &&
            !lesson.videoUrl &&
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
