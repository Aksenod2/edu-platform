'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LessonsManager } from '@/components/lessons-manager';
import {
  ScheduleCalendar,
  type CalendarLesson,
  type CalendarCreateData,
  type CalendarUpdateData,
} from '@/components/schedule-calendar';
import {
  getStreams,
  getLessons,
  createLesson,
  updateLesson,
  deleteLesson,
  type Stream,
} from '@/lib/api';

const ALL_STREAMS = 'all';

type ViewMode = 'program' | 'calendar';

export default function AdminLessonsPage() {
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<Stream[]>([]);
  // 'all' — показывать уроки всех потоков (с колонкой «Поток»); иначе id потока.
  const [selectedStreamId, setSelectedStreamId] = useState<string>(ALL_STREAMS);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStreams = useCallback(async () => {
    if (!accessToken || !user || user.role !== 'admin') return;
    setLoading(true);
    try {
      const { streams: allStreams } = await getStreams(accessToken);
      setStreams(allStreams);
      setSelectedStreamId((prev) =>
        prev === ALL_STREAMS || allStreams.some((s) => s.id === prev) ? prev : ALL_STREAMS,
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков');
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    fetchStreams();
  }, [fetchStreams]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Календарь</h1>
          <p className="text-sm text-muted-foreground">
            Календарь занятий и список уроков
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-1">
            <Button
              variant={viewMode === 'program' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('program')}
            >
              Список
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('calendar')}
            >
              Календарь
            </Button>
          </div>
          {streams.length > 0 && (
            <Select value={selectedStreamId} onValueChange={setSelectedStreamId}>
              <SelectTrigger className="w-full max-w-[220px]">
                <SelectValue placeholder="Поток" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STREAMS}>Все потоки</SelectItem>
                {streams.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} {s.status === 'archived' ? '(архив)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

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
          Потоков пока нет. Создайте поток, чтобы добавлять уроки.
        </p>
      ) : viewMode === 'program' ? (
        <LessonsManager streamId={selectedStreamId === ALL_STREAMS ? '' : selectedStreamId} />
      ) : (
        <LessonsCalendar
          streams={streams}
          selectedStreamId={selectedStreamId === ALL_STREAMS ? '' : selectedStreamId}
        />
      )}
    </div>
  );
}

/** Календарный вид уроков (вкладка «Календарь» раздела «Уроки»). */
function LessonsCalendar({
  streams,
  selectedStreamId,
}: {
  streams: Stream[];
  selectedStreamId: string;
}) {
  const { accessToken } = useAuth();

  const [lessons, setLessons] = useState<CalendarLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLessons = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const byId = new Map(streams.map((s) => [s.id, s.name]));
      let list: CalendarLesson[];
      if (selectedStreamId) {
        const { lessons: streamLessons } = await getLessons(accessToken, selectedStreamId);
        list = streamLessons.map((l) => ({
          ...l,
          streamName: l.stream?.name ?? (l.streamId ? byId.get(l.streamId) : undefined),
        }));
      } else {
        // «Все потоки»: расписание собираем по каждому потоку (Session = занятие).
        // Без streamId бэкенд отдаёт блоки-уроки без расписания (date = null) —
        // на календаре они не видны, поэтому здесь агрегируем по потокам и берём
        // только занятия с датой. Один блок может быть в нескольких потоках, так
        // что правка возможна лишь при выбранном потоке (см. editable ниже).
        const results = await Promise.all(
          streams.map((s) =>
            getLessons(accessToken, s.id)
              .then((res) =>
                res.lessons
                  .filter((l) => l.date)
                  .map((l) => ({ ...l, streamName: l.stream?.name ?? s.name })),
              )
              .catch(() => [] as CalendarLesson[]),
          ),
        );
        list = results.flat();
      }
      setLessons(list);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки уроков');
    } finally {
      setLoading(false);
    }
  }, [accessToken, selectedStreamId, streams]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

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
      await fetchLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания урока');
    }
  };

  const handleUpdate = async (id: string, data: CalendarUpdateData) => {
    if (!accessToken) return;
    setError('');
    try {
      // Новая модель: расписание пишется в Session потока — передаём streamId урока.
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
      await fetchLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления урока');
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    setError('');
    try {
      await deleteLesson(accessToken, id);
      await fetchLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления урока');
    }
  };

  // Потоки для выбора при создании урока из календаря: если выбран конкретный
  // поток — только он, иначе все активные.
  const createStreams = selectedStreamId
    ? streams.filter((s) => s.id === selectedStreamId)
    : streams.filter((s) => s.status === 'active');

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!selectedStreamId && (
        <p className="text-sm text-muted-foreground">
          Показаны занятия всех потоков. Выберите поток, чтобы добавлять и
          редактировать занятия.
        </p>
      )}
      <ScheduleCalendar
        editable={!!selectedStreamId}
        lessons={lessons}
        streams={createStreams}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
