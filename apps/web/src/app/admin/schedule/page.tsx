'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  createLesson,
  unscheduleLesson,
  getLessons,
  getStreams,
  updateLesson,
  type Stream,
} from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ScheduleCalendar,
  type CalendarCreateData,
  type CalendarLesson,
  type CalendarUpdateData,
} from '@/components/schedule-calendar';
import { TodayView } from '@/components/schedule/today-view';
import { WeekView } from '@/components/schedule/week-view';
import { PlanLessonDialog } from '@/components/schedule/plan-lesson-dialog';
import type { ScheduleLesson } from '@/components/schedule/utils';

const ALL_STREAMS = '__all__';
type ViewMode = 'today' | 'week' | 'month';

/**
 * Единое расписание администратора: обзор занятий всех потоков с переключателем
 * Сегодня / Неделя / Месяц и планированием занятий.
 */
export default function AdminSchedulePage() {
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [filterStreamId, setFilterStreamId] = useState<string>(ALL_STREAMS);
  const [view, setView] = useState<ViewMode>('today');
  const [lessons, setLessons] = useState<ScheduleLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!accessToken || !user || user.role !== 'admin') return;
    setLoading(true);
    try {
      const { streams: allStreams } = await getStreams(accessToken);
      const activeStreams = allStreams.filter((s) => s.status === 'active');
      setStreams(activeStreams);
      setFilterStreamId((prev) =>
        prev === ALL_STREAMS || activeStreams.some((s) => s.id === prev) ? prev : ALL_STREAMS,
      );

      // «Все потоки»: расписание собираем по каждому потоку (Session = занятие).
      // Берём только занятия с датой (см. паттерн в dashboard/schedule).
      const results = await Promise.all(
        activeStreams.map((s) =>
          getLessons(accessToken, s.id)
            .then((res) =>
              res.lessons
                .filter((l) => l.date)
                .map<ScheduleLesson>((l) => ({
                  ...l,
                  streamName: l.stream?.name ?? s.name,
                })),
            )
            .catch(() => [] as ScheduleLesson[]),
        ),
      );
      setLessons(results.flat());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки расписания');
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const selectedStreamId = filterStreamId === ALL_STREAMS ? '' : filterStreamId;

  const visibleLessons = useMemo(
    () =>
      selectedStreamId
        ? lessons.filter((l) => l.streamId === selectedStreamId)
        : lessons,
    [lessons, selectedStreamId],
  );

  // «Отметить проведённым» из списочных видов (Сегодня/Неделя): статус занятия
  // (Session потока) → done.
  const handleMarkDone = useCallback(
    async (lesson: ScheduleLesson) => {
      if (!accessToken || !lesson.streamId) return;
      try {
        await updateLesson(accessToken, lesson.id, {
          streamId: lesson.streamId,
          status: 'done',
        });
        await fetchAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось отметить занятие проведённым');
      }
    },
    [accessToken, fetchAll],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Расписание</h1>
          <p className="text-sm text-muted-foreground">
            Занятия всех потоков в одном месте
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {streams.length > 0 && (
            <Select value={filterStreamId} onValueChange={setFilterStreamId}>
              <SelectTrigger className="w-full max-w-[220px]">
                <SelectValue placeholder="Поток" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STREAMS}>Все потоки</SelectItem>
                {streams.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {accessToken && (
            <PlanLessonDialog
              accessToken={accessToken}
              streams={streams}
              defaultStreamId={selectedStreamId || undefined}
              onPlanned={fetchAll}
            />
          )}
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
        <TabsList>
          <TabsTrigger value="today">Сегодня</TabsTrigger>
          <TabsTrigger value="week">Неделя</TabsTrigger>
          <TabsTrigger value="month">Месяц</TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : streams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Активных потоков нет. Создайте поток, чтобы планировать занятия.
        </p>
      ) : view === 'today' ? (
        <TodayView lessons={visibleLessons} onMarkDone={handleMarkDone} />
      ) : view === 'week' ? (
        <WeekView lessons={visibleLessons} onMarkDone={handleMarkDone} />
      ) : (
        <MonthView
          lessons={visibleLessons}
          streams={streams}
          selectedStreamId={selectedStreamId}
          onChanged={fetchAll}
        />
      )}
    </div>
  );
}

/**
 * Месячный вид — переиспользует общий ScheduleCalendar. Редактирование доступно
 * только при выбранном конкретном потоке (один блок может жить в нескольких
 * потоках, поэтому в режиме «Все потоки» правка двусмысленна).
 */
function MonthView({
  lessons,
  streams,
  selectedStreamId,
  onChanged,
}: {
  lessons: CalendarLesson[];
  streams: Stream[];
  selectedStreamId: string;
  onChanged: () => void | Promise<void>;
}) {
  const { accessToken } = useAuth();
  const [error, setError] = useState('');

  const editable = !!selectedStreamId;
  const createStreams = selectedStreamId
    ? streams.filter((s) => s.id === selectedStreamId)
    : streams;

  const handleCreate = async (data: CalendarCreateData) => {
    if (!accessToken) return;
    setError('');
    try {
      await createLesson(accessToken, {
        streamId: data.streamId,
        title: data.title,
        date: data.date || null,
        startTime: data.startTime,
        status: data.status,
        meetingUrl: data.meetingUrl,
        notes: data.notes ?? undefined,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания занятия');
    }
  };

  const handleUpdate = async (id: string, data: CalendarUpdateData) => {
    if (!accessToken) return;
    setError('');
    try {
      // Расписание пишется в Session потока — передаём streamId занятия.
      const targetStreamId = lessons.find((l) => l.id === id)?.streamId;
      await updateLesson(accessToken, id, {
        streamId: targetStreamId,
        title: data.title,
        date: data.date,
        startTime: data.startTime,
        status: data.status,
        meetingUrl: data.meetingUrl,
        notes: data.notes ?? undefined,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления занятия');
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    setError('');
    try {
      // Удаляем именно ЗАНЯТИЕ (Session потока), а не урок-блок целиком.
      const targetStreamId = lessons.find((l) => l.id === id)?.streamId ?? selectedStreamId;
      if (!targetStreamId) return;
      await unscheduleLesson(accessToken, id, targetStreamId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка снятия занятия');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!editable && (
        <p className="text-sm text-muted-foreground">
          Показаны занятия всех потоков. Выберите поток, чтобы редактировать
          занятия прямо в календаре.
        </p>
      )}
      <ScheduleCalendar
        editable={editable}
        lessons={lessons}
        streams={createStreams}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
