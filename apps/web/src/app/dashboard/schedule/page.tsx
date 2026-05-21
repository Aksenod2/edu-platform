'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getSchedule,
  type Stream,
  type ScheduleEntry,
} from '@/lib/api';
import { PageHeader } from '@platform/ui/templates';
import { Card } from '@platform/ui/molecules';
import { Button, Heading, Text, Mono, Spinner, Badge, Divider, Select } from '@platform/ui/atoms';

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
      <PageHeader
        title="Расписание"
        subtitle="Предстоящие занятия и сроки"
        action={
          streams.length > 1 ? (
            <Select
              value={selectedStreamId}
              onChange={(e) => setSelectedStreamId(e.target.value)}
              fullWidth={false}
              style={{ minWidth: 160 }}
            >
              {streams.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          ) : undefined
        }
      />

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--spacing-4)' }}>
          <Text size="sm" color="var(--color-error)">{error}</Text>
        </Card>
      )}

      {loadingEntries ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
          <Spinner size="md" />
        </div>
      ) : entries.length === 0 ? (
        <Text color="tertiary">Расписание пока не заполнено.</Text>
      ) : (
        <>
          {upcomingEntries.length > 0 && (
            <section style={{ marginBottom: 'var(--spacing-8)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)' }}>
                <Mono size="xs" style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', color: 'var(--color-accent-red)' }}>
                  Предстоящие занятия
                </Mono>
                <Badge variant="accent">{upcomingEntries.length}</Badge>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                {upcomingEntries.map((entry) => (
                  <Card
                    key={entry.id}
                    variant="default"
                    padding="sm"
                    style={{ borderLeft: '2px solid var(--color-accent-red)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
                      <Heading level={4} size="md" style={{ margin: 0 }}>{entry.lessonTitle}</Heading>
                      <Mono size="xs" color="var(--color-text-tertiary)">
                        {formatEntryDateTime(entry.date, entry.startTime)}
                      </Mono>
                    </div>
                    {entry.notes && (
                      <Text size="sm" color="secondary" style={{ marginTop: 'var(--spacing-2)', whiteSpace: 'pre-wrap', lineHeight: 'var(--leading-relaxed)' }}>
                        {entry.notes}
                      </Text>
                    )}
                    {entry.meetingUrl && (
                      <div style={{ marginTop: 'var(--spacing-3)' }}>
                        <a href={entry.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                          <Button variant="primary" size="sm">
                            Присоединиться
                          </Button>
                        </a>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          )}

          {upcomingEntries.length > 0 && pastEntries.length > 0 && (
            <Divider spacing="md" />
          )}

          {pastEntries.length > 0 && (
            <section>
              <Mono size="xs" style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--spacing-4)', display: 'block' }}>
                Прошедшие занятия
              </Mono>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
                {pastEntries.map((entry) => (
                  <Card
                    key={entry.id}
                    variant="outlined"
                    padding="sm"
                    style={{ opacity: 0.6, borderLeft: '2px solid var(--color-border-subtle)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
                      <Text size="sm" weight="medium">{entry.lessonTitle}</Text>
                      <Mono size="xs" color="var(--color-text-tertiary)">
                        {formatEntryDateTime(entry.date, entry.startTime)}
                      </Mono>
                    </div>
                    {entry.notes && (
                      <Text size="xs" color="tertiary" style={{ marginTop: 'var(--spacing-1)', whiteSpace: 'pre-wrap' }}>
                        {entry.notes}
                      </Text>
                    )}
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
