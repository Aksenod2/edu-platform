'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, PlayCircle, ChevronRight, BookOpen, Layers } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getLessons,
  type Stream,
  type Lesson,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LivePulseDot } from '@/components/schedule/lesson-status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

function isUpcoming(lesson: Lesson): boolean {
  return lesson.status === 'planned';
}

/** Аккуратное пустое состояние: иконка + заголовок + пояснение. */
function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof BookOpen;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
      <Icon className="size-10 opacity-50" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-sm">{description}</p>
    </div>
  );
}

function StudentLessonsContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();
  const streamIdParam = searchParams.get('streamId');

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(streamIdParam);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');

  const fetchStreams = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await getStreams(accessToken);
      setStreams(data.streams);
      if (!selectedStreamId && data.streams.length > 0) {
        setSelectedStreamId(data.streams[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки групп');
    }
  }, [accessToken, selectedStreamId]);

  const fetchLessons = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingData(true);
    try {
      const data = await getLessons(accessToken, selectedStreamId);
      setLessons([...data.lessons].sort((a, b) => a.sortOrder - b.sortOrder));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки уроков');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') {
      fetchStreams();
    }
  }, [accessToken, user, fetchStreams]);

  useEffect(() => {
    if (selectedStreamId) {
      fetchLessons();
    }
  }, [selectedStreamId, fetchLessons]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Уроки</h1>
        <p className="text-sm text-muted-foreground">Видеозаписи, конспекты, материалы</p>
      </div>

      {/* Переключатель потоков: вкладки показываем только если потоков больше одного */}
      {streams.length > 1 ? (
        <Tabs
          value={selectedStreamId || ''}
          onValueChange={(value) => setSelectedStreamId(value)}
        >
          {/* Горизонтальная прокрутка списка вкладок на узких экранах без слома вёрстки */}
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="w-max">
              {streams.map((s) => (
                <TabsTrigger key={s.id} value={s.id} className="flex-none shrink-0">
                  {s.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      ) : null}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {streams.length === 0 && !loadingData ? (
        <EmptyState
          icon={Layers}
          title="Групп пока нет"
          description="Когда вас зачислят в группу, здесь появятся уроки."
        />
      ) : loadingData ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : lessons.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Уроков пока нет"
          description="В этой группе ещё нет доступных уроков."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson, index) => {
            const upcoming = isUpcoming(lesson);
            const cancelled = lesson.status === 'cancelled';
            const live = lesson.status === 'live';
            // Учебное видео урока (лекция): файл, ссылка или несколько видео.
            // Запись Zoom-занятия — отдельная сущность, в индикатор не входит.
            const hasVideo = !!(
              (lesson.videos && lesson.videos.length > 0) ||
              lesson.videoFileUrl ||
              lesson.videoUrl
            );

            return (
              <Link
                key={lesson.id}
                href={`/dashboard/lessons/${lesson.id}${selectedStreamId ? `?streamId=${selectedStreamId}` : ''}`}
                className="no-underline"
              >
                <Card
                  className={`p-0 transition-colors hover:bg-accent/50${cancelled ? ' opacity-60' : ''}`}
                >
                  <CardContent className="flex items-center gap-4 px-5 py-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Урок {index + 1}
                        </span>
                        {cancelled ? (
                          <Badge variant="destructive">Отменён</Badge>
                        ) : live ? (
                          <Badge className="gap-1.5 font-medium">
                            <LivePulseDot />
                            Идёт
                          </Badge>
                        ) : upcoming ? (
                          <Badge variant="secondary">Запланирован</Badge>
                        ) : (
                          <Badge>Доступен</Badge>
                        )}
                      </div>
                      <h3 className="truncate text-base font-semibold tracking-tight">
                        {lesson.title}
                      </h3>
                      {lesson.summary && (
                        <p className="truncate text-sm text-muted-foreground">{lesson.summary}</p>
                      )}
                    </div>
                    {hasVideo && (
                      <PlayCircle className="size-5 shrink-0 text-muted-foreground" />
                    )}
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function StudentLessonsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <StudentLessonsContent />
    </Suspense>
  );
}
