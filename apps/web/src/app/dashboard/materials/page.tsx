'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ChevronDown, FolderOpen, Play } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { getStreams, getLessons, type Stream, type Lesson } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { MaterialRow } from '@/components/material-row';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function MaterialsContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>(searchParams.get('streamId') || '');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !user) return;
    getStreams(accessToken)
      .then((data) => {
        const active = data.streams.filter((s) => s.status === 'active');
        setStreams(active);
        if (!selectedStreamId && active.length > 0) {
          setSelectedStreamId(active[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков'));
  }, [accessToken, user, selectedStreamId]);

  const fetchLessons = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingData(true);
    try {
      const data = await getLessons(accessToken, selectedStreamId);
      setLessons(data.lessons.filter((l) => l.status === 'published'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки материалов');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (selectedStreamId) fetchLessons();
  }, [selectedStreamId, fetchLessons]);

  const hasContent = (l: Lesson) =>
    !!l.videoUrl || !!l.summary || (l.materials?.length ?? 0) > 0;
  const lessonsWithMaterials = lessons.filter(hasContent);
  const lessonsWithoutMaterials = lessons.filter((l) => !hasContent(l));

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Учебные материалы</h1>
          <p className="text-sm text-muted-foreground">Видеозаписи, описания и файлы к урокам</p>
        </div>
        {streams.length > 1 ? (
          <Select
            value={selectedStreamId}
            onValueChange={(value) => { setSelectedStreamId(value); setExpandedId(null); }}
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

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="mb-6 mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats bar */}
      {!loadingData && lessons.length > 0 && (
        <div className="mb-6 mt-4 flex items-center gap-6 border-b pb-4">
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{lessons.length}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Уроков</p>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{lessonsWithMaterials.length}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">С материалами</p>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">
              {lessons.filter((l) => l.videoUrl).length}
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Видео</p>
          </div>
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : lessons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center text-muted-foreground">
          <FolderOpen className="size-10 opacity-50" aria-hidden />
          <p className="text-sm font-medium text-foreground">Материалов пока нет</p>
          <p className="text-sm max-w-xs">
            Преподаватель ещё не добавил материалы к урокам этого потока
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Lessons with materials */}
          {lessonsWithMaterials.map((lesson, idx) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              index={idx + 1}
              expanded={expandedId === lesson.id}
              onToggle={() => setExpandedId(expandedId === lesson.id ? null : lesson.id)}
            />
          ))}

          {/* Lessons without materials — collapsed footer */}
          {lessonsWithoutMaterials.length > 0 && (
            <div className="mt-6 rounded-lg border border-dashed px-5 py-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {lessonsWithoutMaterials.length} {lessonsWithoutMaterials.length === 1 ? 'урок' : 'уроков'} без материалов
              </p>
              <div className="mt-2 space-y-1">
                {lessonsWithoutMaterials.map((l) => (
                  <p key={l.id} className="text-xs text-muted-foreground">
                    · {l.title}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function LessonCard({
  lesson,
  index,
  expanded,
  onToggle,
}: {
  lesson: Lesson;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasVideo = !!lesson.videoUrl;
  const hasSummary = !!lesson.summary;
  const files = lesson.materials ?? [];
  const hasFiles = files.length > 0;

  return (
    <Card className="overflow-hidden p-0">
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted transition-colors focus:outline-none"
      >
        {/* Index dot */}
        <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md border text-xs text-muted-foreground">
          {String(index).padStart(2, '0')}
        </span>

        {/* Title */}
        <span className="flex-1 text-sm font-medium text-foreground truncate">
          {lesson.title}
        </span>

        {/* Material badges */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {hasVideo && <Badge variant="default">Видео</Badge>}
          {hasSummary && <Badge variant="secondary">Краткое описание</Badge>}
          {hasFiles && <Badge variant="outline">Файлы</Badge>}
        </div>

        {/* Expand icon */}
        <ChevronDown
          className={`flex-shrink-0 size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-5 py-5 space-y-5 bg-muted">
          {/* Video */}
          {hasVideo && (
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Видеозапись
              </p>
              <Button asChild variant="outline" size="sm">
                <a href={lesson.videoUrl!} target="_blank" rel="noopener noreferrer">
                  <Play className="size-4" />
                  Открыть видео
                </a>
              </Button>
            </div>
          )}

          {/* Summary */}
          {hasSummary && (
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Краткое описание
              </p>
              <div className="border-l-2 pl-4">
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {lesson.summary}
                </p>
              </div>
            </div>
          )}

          {/* Files (PDF/MD) */}
          {hasFiles && (
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Файлы (PDF/MD)
              </p>
              <div className="flex flex-col gap-2">
                {files.map((m) => (
                  <MaterialRow key={m.s3Key} material={m} />
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="pt-2 border-t flex items-center gap-4">
            {lesson.publishAt && (
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {new Date(lesson.publishAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
            <Button
              variant="link"
              size="sm"
              className="ml-auto"
              onClick={() => window.open(`/dashboard/lessons?streamId=${lesson.streamId}`, '_self')}
            >
              Все уроки →
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function MaterialsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <MaterialsContent />
    </Suspense>
  );
}
