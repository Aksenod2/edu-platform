'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getLessons,
  LESSON_STATUS_LABELS,
  type Lesson,
  type LessonStatus,
} from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

/** Урок с прикреплённым именем потока. */
type AgendaLesson = Lesson & { streamName?: string };

const STATUS_BADGE_VARIANT: Record<
  LessonStatus,
  'secondary' | 'default' | 'outline' | 'destructive'
> = {
  draft: 'secondary',
  planned: 'default',
  done: 'outline',
  cancelled: 'destructive',
};

/** Парсит дату из ISO-строки как локальную (без UTC-сдвига). */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

/** Дата без времени (полночь) для сравнения дней. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Форматирует дату занятия в человекочитаемый вид (ru-RU) + время, если есть. */
function formatLessonDate(lesson: AgendaLesson): string {
  if (!lesson.date) return '';
  const dateLabel = parseLocalDate(lesson.date).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  return lesson.startTime ? `${dateLabel}, ${lesson.startTime}` : dateLabel;
}

/** Сортировка по дате, затем по времени начала. */
function byDateThenTime(a: AgendaLesson, b: AgendaLesson): number {
  const dateCmp = (a.date ?? '').localeCompare(b.date ?? '');
  if (dateCmp !== 0) return dateCmp;
  return (a.startTime ?? '').localeCompare(b.startTime ?? '');
}

export default function AdminTodayPage() {
  const { user, accessToken } = useAuth();

  const [allStreamsMode, setAllStreamsMode] = useState(false);
  const [lessons, setLessons] = useState<AgendaLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!accessToken || !user) return;
    setLoading(true);
    try {
      // По умолчанию — только мои потоки; тумблер «Все потоки» снимает фильтр.
      const { streams } = await getStreams(
        accessToken,
        allStreamsMode ? undefined : { mine: true },
      );
      const activeStreams = streams.filter((s) => s.status === 'active');

      const results = await Promise.all(
        activeStreams.map((s) => getLessons(accessToken, s.id)),
      );
      const merged: AgendaLesson[] = results.flatMap((res, i) => {
        const s = activeStreams[i]!;
        return res.lessons
          // Берём только уроки с заданной датой.
          .filter((l) => l.date)
          .map((l) => ({ ...l, streamName: l.stream?.name ?? s.name }));
      });
      setLessons(merged);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки агенды');
    } finally {
      setLoading(false);
    }
  }, [accessToken, user, allStreamsMode]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const { todayLessons, weekLessons } = useMemo(() => {
    const today = startOfDay(new Date());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const todayList: AgendaLesson[] = [];
    const weekList: AgendaLesson[] = [];

    for (const lesson of lessons) {
      if (!lesson.date) continue;
      const d = startOfDay(parseLocalDate(lesson.date));
      if (d.getTime() === today.getTime()) {
        todayList.push(lesson);
      } else if (d >= tomorrow && d <= weekEnd) {
        weekList.push(lesson);
      }
      // Прошедшие занятия и без даты игнорируем.
    }

    todayList.sort(byDateThenTime);
    weekList.sort(byDateThenTime);
    return { todayLessons: todayList, weekLessons: weekList };
  }, [lessons]);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Сегодня</h1>
          <p className="text-sm text-muted-foreground">Ваши ближайшие занятия</p>
        </div>
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={allStreamsMode}
            onCheckedChange={(v) => setAllStreamsMode(v === true)}
          />
          Все потоки
        </Label>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-8">
          <AgendaSection
            title="Сегодня"
            lessons={todayLessons}
            emptyText="На сегодня занятий нет"
          />
          <AgendaSection
            title="На неделе"
            lessons={weekLessons}
            emptyText="На этой неделе занятий нет"
          />
        </div>
      )}
    </>
  );
}

function AgendaSection({
  title,
  lessons,
  emptyText,
}: {
  title: string;
  lessons: AgendaLesson[];
  emptyText: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {lessons.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
        </div>
      )}
    </section>
  );
}

function LessonRow({ lesson }: { lesson: AgendaLesson }) {
  // TODO: показать «кто оплатил» по занятию — добавится вместе с балансом (#7).
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <p
            className={
              lesson.status === 'cancelled'
                ? 'font-medium leading-tight line-through'
                : 'font-medium leading-tight'
            }
          >
            {lesson.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={STATUS_BADGE_VARIANT[lesson.status]}>
              {LESSON_STATUS_LABELS[lesson.status]}
            </Badge>
            {lesson.streamName && (
              <Badge variant="secondary">{lesson.streamName}</Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {formatLessonDate(lesson)}
            </span>
          </div>
        </div>
        {lesson.meetingUrl && lesson.status !== 'cancelled' && (
          <a
            href={lesson.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 no-underline"
          >
            <Button size="sm">Подключиться</Button>
          </a>
        )}
      </CardContent>
    </Card>
  );
}
