'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getSchedule,
  type Stream,
  type ScheduleEntry,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Парсит дату из ISO-строки как локальную (без UTC-сдвига) */
function parseLocalDate(dateStr: string, startTime: string): Date {
  const datePart = dateStr.slice(0, 10); // "YYYY-MM-DD"
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = startTime.split(':').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, 0, 0);
}

function isPast(dateStr: string, startTime: string): boolean {
  return parseLocalDate(dateStr, startTime) < new Date();
}

/** Форматирует дату и время занятия с указанием локального часового пояса */
function formatEntryDateTime(dateStr: string, startTime: string): string {
  const dt = parseLocalDate(dateStr, startTime);
  const datePart = dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const timePart = dt.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `${datePart}, ${timePart}`;
}

export default function StudentSchedulePage() {
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accessToken || !user) return;
    getStreams(accessToken)
      .then((data) => {
        const activeStreams = data.streams.filter((s) => s.status === 'active');
        setStreams(activeStreams);
        if (activeStreams.length > 0 && !selectedStreamId) {
          setSelectedStreamId(activeStreams[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков'));
  }, [accessToken, user, selectedStreamId]);

  const fetchSchedule = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingEntries(true);
    try {
      const data = await getSchedule(accessToken, selectedStreamId);
      setEntries(data.schedule);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки расписания');
    } finally {
      setLoadingEntries(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (selectedStreamId) fetchSchedule();
  }, [selectedStreamId, fetchSchedule]);

  const upcomingEntries = entries.filter((e) => !isPast(e.date, e.startTime));
  const pastEntries = entries.filter((e) => isPast(e.date, e.startTime));

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Расписание</h1>
          <p className="text-sm text-muted-foreground">Предстоящие занятия и сроки</p>
        </div>
        {streams.length > 1 ? (
          <Select value={selectedStreamId} onValueChange={setSelectedStreamId}>
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

      {loadingEntries ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Расписание пока не заполнено.</p>
      ) : (
        <>
          {upcomingEntries.length > 0 && (
            <section className="mb-8">
              <div className="mb-4 flex items-center gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-foreground">
                  Предстоящие занятия
                </span>
                <Badge variant="secondary">{upcomingEntries.length}</Badge>
              </div>
              <div className="flex flex-col gap-3">
                {upcomingEntries.map((entry) => (
                  <Card
                    key={entry.id}
                    style={{ borderLeft: '2px solid var(--color-accent-red)' }}
                  >
                    <CardContent>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-lg font-semibold tracking-tight">{entry.lessonTitle}</h4>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatEntryDateTime(entry.date, entry.startTime)}
                        </span>
                      </div>
                      {entry.notes && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                          {entry.notes}
                        </p>
                      )}
                      {entry.meetingUrl && (
                        <div className="mt-3">
                          <a href={entry.meetingUrl} target="_blank" rel="noopener noreferrer" className="no-underline">
                            <Button size="sm">
                              Присоединиться
                            </Button>
                          </a>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {upcomingEntries.length > 0 && pastEntries.length > 0 && (
            <Separator className="my-4" />
          )}

          {pastEntries.length > 0 && (
            <section>
              <span className="mb-4 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Прошедшие занятия
              </span>
              <div className="flex flex-col gap-2">
                {pastEntries.map((entry) => (
                  <Card
                    key={entry.id}
                    style={{ opacity: 0.6, borderLeft: '2px solid var(--color-border-subtle)' }}
                  >
                    <CardContent>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{entry.lessonTitle}</p>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatEntryDateTime(entry.date, entry.startTime)}
                        </span>
                      </div>
                      {entry.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                          {entry.notes}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
