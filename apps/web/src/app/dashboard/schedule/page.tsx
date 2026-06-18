'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getStreams, getLessons, getMeetings, type Stream } from '@/lib/api';
import { meetingToCalendarLesson } from '@/components/meetings/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScheduleCalendar, type CalendarLesson } from '@/components/schedule-calendar';

const ALL_STREAMS = '__all__';

export default function StudentSchedulePage() {
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [filterStreamId, setFilterStreamId] = useState<string>(ALL_STREAMS);
  const [lessons, setLessons] = useState<CalendarLesson[]>([]);
  // Встречи 1-на-1 студента (эпик #154). У встречи нет потока, поэтому фильтр по
  // группе на них не действует — показываем всегда.
  const [meetings, setMeetings] = useState<CalendarLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!accessToken || !user) return;
    setLoading(true);
    try {
      const { streams: allStreams } = await getStreams(accessToken);
      const activeStreams = allStreams.filter((s) => s.status === 'active');
      setStreams(activeStreams);

      const results = await Promise.all(
        activeStreams.map((s) => getLessons(accessToken, s.id)),
      );
      const merged: CalendarLesson[] = results.flatMap((res, i) => {
        const s = activeStreams[i]!;
        return res.lessons
          // На календаре показываем только уроки, у которых задана дата.
          .filter((l) => l.date)
          .map((l) => ({
            ...l,
            streamName: l.stream?.name ?? s.name,
          }));
      });
      setLessons(merged);

      // Встречи 1-на-1 — отдельный запрос (не валит расписание при ошибке).
      try {
        const { meetings: mtgs } = await getMeetings(accessToken);
        setMeetings(
          mtgs
            .filter((m) => m.date)
            .map((m) => meetingToCalendarLesson(m, '/dashboard/meetings')),
        );
      } catch {
        setMeetings([]);
      }

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

  const visibleLessons =
    filterStreamId === ALL_STREAMS
      ? [...lessons, ...meetings]
      : [...lessons.filter((l) => l.streamId === filterStreamId), ...meetings];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Расписание</h1>
          <p className="text-sm text-muted-foreground">Предстоящие занятия и сроки</p>
        </div>
        {streams.length > 1 ? (
          <Select value={filterStreamId} onValueChange={setFilterStreamId}>
            <SelectTrigger className="w-full max-w-[200px]">
              <SelectValue placeholder="Группа" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STREAMS}>Все группы</SelectItem>
              {streams.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
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

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-4">
          <ScheduleCalendar
            lessons={visibleLessons}
            editable={false}
            lessonBasePath="/dashboard/lessons"
          />
        </div>
      )}
    </>
  );
}
