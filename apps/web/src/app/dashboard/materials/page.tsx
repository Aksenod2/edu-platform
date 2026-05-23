'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ChevronDown, ExternalLink, FolderOpen, Play } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { getStreams, getLessons, type Stream, type Lesson } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { MaterialRow } from '@/components/material-row';
import { VideoEmbedFrame, VideoFileFrame } from '@/components/lessons/video-frame';
import { parseVideoEmbed } from '@/lib/video-embed';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Дата "YYYY-MM-DD" в формате "Д месяц ГГГГ" (без UTC-сдвига). */
function formatLessonDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Урок личной полки: к стандартному уроку добавлено имя потока для бейджа. */
type ShelfLesson = Lesson & { streamName?: string };

/** Спец-значение фильтра «Все потоки» (агрегированный вид по умолчанию). */
const ALL_STREAMS = '__all__';

function MaterialsContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();

  const [streams, setStreams] = useState<Stream[]>([]);
  // По умолчанию — агрегированный вид «Все потоки». Если в URL пришёл streamId — открываем его.
  const [selectedStreamId, setSelectedStreamId] = useState<string>(
    searchParams.get('streamId') || ALL_STREAMS,
  );
  const [lessons, setLessons] = useState<ShelfLesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Загружаем ВСЕ активные потоки студента и сразу собираем уроки со всех — личная полка.
  useEffect(() => {
    if (!accessToken || !user) return;
    let cancelled = false;
    setLoadingData(true);
    (async () => {
      try {
        const data = await getStreams(accessToken);
        const active = data.streams.filter((s) => s.status === 'active');
        if (cancelled) return;
        setStreams(active);

        // Параллельно тянем уроки каждого потока и склеиваем в единый список.
        const results = await Promise.all(
          active.map((s) =>
            getLessons(accessToken, s.id)
              .then((res) =>
                res.lessons
                  // Студенту видны только недрафтовые уроки (черновики бэкенд и так не отдаёт).
                  .filter((l) => l.status !== 'draft')
                  // TODO: позже здесь добавится более строгая фильтрация «только пройденные
                  // уроки» (per-progress gating) — после рефактора модели прогресса.
                  .map<ShelfLesson>((l) => ({
                    ...l,
                    streamName: l.stream?.name ?? s.name,
                  })),
              )
              .catch(() => [] as ShelfLesson[]),
          ),
        );
        if (cancelled) return;
        setLessons(results.flat());
        setError('');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Ошибка загрузки материалов');
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, user]);

  const showStreamBadge = selectedStreamId === ALL_STREAMS;

  // Фильтр по выбранному потоку применяется к уже собранному списку (client-side).
  const visibleLessons =
    selectedStreamId === ALL_STREAMS
      ? lessons
      : lessons.filter((l) => l.streamId === selectedStreamId);

  // Стабильная сортировка: сначала по потоку, затем по дате (более новые выше),
  // затем по sortOrder. Уроки без даты не должны ронять сравнение.
  const sortedLessons = [...visibleLessons].sort((a, b) => {
    const byStream = (a.streamName ?? '').localeCompare(b.streamName ?? '', 'ru');
    if (byStream !== 0) return byStream;
    const dateA = a.date ?? '';
    const dateB = b.date ?? '';
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  // Учебное видео урока: несколько видео (videos[]), загруженный файл (videoFileUrl)
  // или внешняя ссылка (videoUrl). Запись Zoom-занятия сюда НЕ входит.
  const hasLessonVideo = (l: Lesson) =>
    (l.videos?.length ?? 0) > 0 || !!l.videoFileUrl || !!l.videoUrl;
  const hasContent = (l: Lesson) =>
    hasLessonVideo(l) || !!l.summary || (l.materials?.length ?? 0) > 0;
  const lessonsWithMaterials = sortedLessons.filter(hasContent);
  const lessonsWithoutMaterials = sortedLessons.filter((l) => !hasContent(l));

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Материалы</h1>
          <p className="text-sm text-muted-foreground">Всё, к чему у вас есть доступ</p>
        </div>
        {streams.length > 1 ? (
          <Select
            value={selectedStreamId}
            onValueChange={(value) => { setSelectedStreamId(value); setExpandedId(null); }}
          >
            <SelectTrigger className="w-full max-w-[220px]">
              <SelectValue placeholder="Поток" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STREAMS}>Все потоки</SelectItem>
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

      {/* Stats bar — по текущему видимому набору */}
      {!loadingData && sortedLessons.length > 0 && (
        <div className="mb-6 mt-4 flex items-center gap-6 border-b pb-4">
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{sortedLessons.length}</p>
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
              {sortedLessons.filter(hasLessonVideo).length}
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Видео</p>
          </div>
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : sortedLessons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center text-muted-foreground">
          <FolderOpen className="size-10 opacity-50" aria-hidden />
          <p className="text-sm font-medium text-foreground">Материалов пока нет</p>
          <p className="text-sm max-w-xs">
            Преподаватель ещё не добавил материалы к вашим урокам
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
              streamName={showStreamBadge ? lesson.streamName : undefined}
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
                    {showStreamBadge && l.streamName ? ` — ${l.streamName}` : ''}
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
  streamName,
}: {
  lesson: Lesson;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  /** Имя потока — показываем бейджем в режиме «Все потоки». */
  streamName?: string;
}) {
  // Учебное видео: несколько (videos[]), загруженный файл или внешняя ссылка.
  const videos = lesson.videos ?? [];
  const hasVideo = videos.length > 0 || !!lesson.videoFileUrl || !!lesson.videoUrl;
  // Внешняя ссылка одиночного видео → embed (для встроенного плеера), иначе кнопка-ссылка.
  const embedUrl = lesson.videoUrl ? parseVideoEmbed(lesson.videoUrl) : null;
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

        {/* Title + stream */}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-foreground truncate">
            {lesson.title}
          </span>
          {streamName && (
            <span className="mt-1 inline-flex">
              <Badge variant="outline" className="text-muted-foreground font-normal">
                {streamName}
              </Badge>
            </span>
          )}
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
          {/* Учебное видео урока: несколько видео → список плееров; иначе
              одиночное (файл / embed / внешняя ссылка кнопкой). */}
          {hasVideo && (
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Учебное видео
              </p>
              {videos.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {videos.map((video) => {
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
                          <Button asChild variant="outline" size="sm" className="w-fit">
                            <a href={video.url} target="_blank" rel="noopener noreferrer">
                              <Play className="size-4" />
                              Открыть видео
                              <ExternalLink className="size-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : lesson.videoFileUrl ? (
                <VideoFileFrame src={lesson.videoFileUrl} label={lesson.title} />
              ) : embedUrl ? (
                <VideoEmbedFrame src={embedUrl} title={lesson.title} />
              ) : (
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <a href={lesson.videoUrl!} target="_blank" rel="noopener noreferrer">
                    <Play className="size-4" />
                    Открыть видео
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              )}
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
            {lesson.date && (
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {formatLessonDate(lesson.date)}
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
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <MaterialsContent />
    </Suspense>
  );
}
