'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getLessons,
  type Stream,
  type Lesson,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function StudentLessonsContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();
  const streamIdParam = searchParams.get('streamId');

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(streamIdParam);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков');
    }
  }, [accessToken, selectedStreamId]);

  const fetchLessons = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingData(true);
    try {
      const data = await getLessons(accessToken, selectedStreamId);
      setLessons(data.lessons);
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
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Уроки</h1>
          <p className="text-sm text-muted-foreground">Видеозаписи, конспекты, материалы</p>
        </div>
        {streams.length > 1 ? (
          <Select
            value={selectedStreamId || ''}
            onValueChange={(value) => {
              setSelectedStreamId(value);
              setExpandedLessonId(null);
            }}
          >
            <SelectTrigger className="w-full max-w-[200px]">
              <SelectValue placeholder="Поток" />
            </SelectTrigger>
            <SelectContent>
              {streams.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {streams.length === 0 && !loadingData ? (
        <p className="text-sm text-muted-foreground">Потоков пока нет.</p>
      ) : loadingData ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : lessons.length === 0 ? (
        <p className="text-sm text-muted-foreground">В этом потоке пока нет доступных уроков.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson) => {
            const isClosed = lesson.status === 'closed';
            const isExpanded = expandedLessonId === lesson.id;

            return (
              <Card
                key={lesson.id}
                className="p-0"
                style={{ opacity: isClosed ? 0.5 : 1 }}
              >
                <div
                  onClick={() => !isClosed && setExpandedLessonId(isExpanded ? null : lesson.id)}
                  className="flex items-center justify-between px-5 py-4"
                  style={{ cursor: isClosed ? 'default' : 'pointer' }}
                >
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold tracking-tight">
                      {lesson.title}
                    </h3>
                    {isClosed && (
                      <Badge variant="destructive">Недоступен</Badge>
                    )}
                  </div>
                  {!isClosed && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  )}
                </div>

                {isExpanded && !isClosed && (
                  <div className="border-t px-5 pb-5">
                    {lesson.videoUrl && (
                      <div className="mt-4 mb-4">
                        <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer" className="no-underline">
                          <Button size="sm">
                            Смотреть видео
                          </Button>
                        </a>
                      </div>
                    )}

                    {lesson.summary && (
                      <div className="mt-3">
                        <h4 className="mb-2 text-lg font-semibold tracking-tight">Описание</h4>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                          {lesson.summary}
                        </p>
                      </div>
                    )}

                    {lesson.notes && (
                      <div className="mt-4">
                        <h4 className="mb-2 text-lg font-semibold tracking-tight">Конспект</h4>
                        <Card className="bg-muted">
                          <CardContent>
                            <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                              {lesson.notes}
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {!lesson.videoUrl && !lesson.summary && !lesson.notes && (
                      <p className="mt-3 text-sm italic text-muted-foreground">
                        Контент пока не добавлен.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function StudentLessonsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <StudentLessonsContent />
    </Suspense>
  );
}
