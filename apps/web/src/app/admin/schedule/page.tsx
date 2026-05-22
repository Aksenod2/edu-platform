'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScheduleCalendar, type CalendarEntry } from '@/components/schedule-calendar';
import {
  getStreams,
  getSchedule,
  getLessons,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  type Stream,
  type Lesson,
} from '@/lib/api';

const ALL_STREAMS = '__all__';

type ViewMode = 'calendar' | 'table';

/** Дата в формате "ДД.ММ.ГГГГ" из ISO-строки (без UTC-сдвига). */
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
  ).toLocaleDateString('ru-RU');
}

export default function SchedulePage() {
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [filterStreamId, setFilterStreamId] = useState<string>(ALL_STREAMS);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!accessToken || !user || user.role !== 'admin') return;
    setLoading(true);
    try {
      const { streams: allStreams } = await getStreams(accessToken);
      setStreams(allStreams);

      const [results, lessonResults] = await Promise.all([
        Promise.all(allStreams.map((s) => getSchedule(accessToken, s.id))),
        Promise.all(allStreams.map((s) => getLessons(accessToken, s.id))),
      ]);
      const merged: CalendarEntry[] = results.flatMap((res, i) => {
        const s = allStreams[i]!;
        return res.schedule.map((e) => ({
          ...e,
          streamName: s.name,
          stream: { id: s.id, name: s.name },
        }));
      });
      setEntries(merged);
      setLessons(lessonResults.flatMap((res) => res.lessons));
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
    lessonId: string;
    date: string;
    startTime: string;
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
      lessonId?: string;
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

  const sortedEntries = useMemo(
    () =>
      [...visibleEntries].sort((a, b) => {
        const byDate = a.date.slice(0, 10).localeCompare(b.date.slice(0, 10));
        return byDate !== 0 ? byDate : a.startTime.localeCompare(b.startTime);
      }),
    [visibleEntries],
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Расписание</h1>
          <p className="text-sm text-muted-foreground">Управление расписанием занятий</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-1">
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('calendar')}
            >
              Календарь
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
            >
              Таблица
            </Button>
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
      ) : viewMode === 'calendar' ? (
        <div className="mt-4">
          <ScheduleCalendar
            editable
            entries={visibleEntries}
            streams={streams}
            lessons={lessons}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Время</TableHead>
                <TableHead>Урок/Занятие</TableHead>
                <TableHead>Поток</TableHead>
                <TableHead>Ссылка на созвон</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedEntries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Записей в расписании нет
                  </TableCell>
                </TableRow>
              ) : (
                sortedEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDate(entry.date)}</TableCell>
                    <TableCell className="font-mono">{entry.startTime}</TableCell>
                    <TableCell>{entry.lessonTitle || entry.lesson?.title}</TableCell>
                    <TableCell>{entry.stream?.name ?? entry.streamName ?? '—'}</TableCell>
                    <TableCell>
                      {entry.meetingUrl ? (
                        <a
                          href={entry.meetingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          Открыть
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
