'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScheduleCalendar, type CalendarEntry } from '@/components/schedule-calendar';
import {
  getStreams,
  getSchedule,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  type Stream,
} from '@/lib/api';

const ALL_STREAMS = '__all__';

export default function SchedulePage() {
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [filterStreamId, setFilterStreamId] = useState<string>(ALL_STREAMS);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!accessToken || !user || user.role !== 'admin') return;
    setLoading(true);
    try {
      const { streams: allStreams } = await getStreams(accessToken);
      setStreams(allStreams);

      const results = await Promise.all(
        allStreams.map((s) => getSchedule(accessToken, s.id)),
      );
      const merged: CalendarEntry[] = results.flatMap((res, i) => {
        const s = allStreams[i]!;
        return res.schedule.map((e) => ({
          ...e,
          streamName: s.name,
          stream: { id: s.id, name: s.name },
        }));
      });
      setEntries(merged);
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

  const handleCreate = async (data: {
    streamId: string;
    date: string;
    startTime: string;
    lessonTitle: string;
    notes?: string;
    meetingUrl?: string;
  }) => {
    if (!accessToken) return;
    setError('');
    try {
      await createScheduleEntry(accessToken, data);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания записи');
    }
  };

  const handleUpdate = async (
    id: string,
    data: {
      date?: string;
      startTime?: string;
      lessonTitle?: string;
      notes?: string | null;
      meetingUrl?: string | null;
    },
  ) => {
    if (!accessToken) return;
    setError('');
    try {
      await updateScheduleEntry(accessToken, id, data);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления записи');
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    setError('');
    try {
      await deleteScheduleEntry(accessToken, id);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления записи');
    }
  };

  const visibleEntries =
    filterStreamId === ALL_STREAMS
      ? entries
      : entries.filter((e) => e.streamId === filterStreamId);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Расписание</h1>
          <p className="text-sm text-muted-foreground">Управление расписанием занятий</p>
        </div>
        <Select value={filterStreamId} onValueChange={setFilterStreamId}>
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
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4 mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-4">
          <ScheduleCalendar
            editable
            entries={visibleEntries}
            streams={streams}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        </div>
      )}
    </>
  );
}
