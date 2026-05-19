'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getSchedule,
  type Stream,
  type ScheduleEntry,
} from '@/lib/api';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card } from '@platform/ui/molecules';
import { Heading, Text, Mono } from '@platform/ui/atoms';
import { Spinner } from '@platform/ui/atoms';
import { Badge } from '@platform/ui/atoms';
import { Divider } from '@platform/ui/atoms';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',      href: '/dashboard',            icon: <GridIcon /> },
      { label: 'Уроки',      href: '/dashboard/lessons',    icon: <BookIcon /> },
      { label: 'Задания',    href: '/dashboard/assignments', icon: <ClipboardIcon /> },
      { label: 'Тред',       href: '/dashboard/thread',     icon: <ChatIcon /> },
      { label: 'Расписание', href: '/dashboard/schedule',   icon: <CalendarIcon /> },
      { label: 'Профиль',    href: '/dashboard/profile',    icon: <UserIcon /> },
    ],
  },
];

function isPast(dateStr: string, startTime: string): boolean {
  const entryDate = new Date(dateStr);
  const [hours, minutes] = startTime.split(':').map(Number);
  entryDate.setHours(hours || 0, minutes || 0, 0, 0);
  return entryDate < new Date();
}

export default function StudentSchedulePage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  const upcomingEntries = entries.filter((e) => !isPast(e.date, e.startTime));
  const pastEntries = entries.filter((e) => isPast(e.date, e.startTime));

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: user.role as 'admin' | 'student' },
        onLogout: async () => { await logout(); router.push('/login'); },
      }}
      sidebar={{ sections: STUDENT_NAV }}
    >
      <PageHeader
        title="Расписание"
        subtitle="Предстоящие занятия и сроки"
        action={
          streams.length > 1 ? (
            <select
              value={selectedStreamId}
              onChange={(e) => setSelectedStreamId(e.target.value)}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {streams.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>
          <Text size="sm" color="var(--color-error)">{error}</Text>
        </Card>
      )}

      {loadingEntries ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
          <Spinner size="md" />
        </div>
      ) : entries.length === 0 ? (
        <Text color="tertiary">Расписание пока не заполнено.</Text>
      ) : (
        <>
          {upcomingEntries.length > 0 && (
            <section style={{ marginBottom: 'var(--space-8)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <Mono size="xs" style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', color: 'var(--color-accent-red)' }}>
                  Предстоящие занятия
                </Mono>
                <Badge variant="accent">{upcomingEntries.length}</Badge>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {upcomingEntries.map((entry) => (
                  <Card
                    key={entry.id}
                    variant="default"
                    padding="sm"
                    style={{ borderLeft: '2px solid var(--color-accent-red)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      <Heading level={4} size="md" style={{ margin: 0 }}>{entry.lessonTitle}</Heading>
                      <Mono size="xs" color="var(--color-text-tertiary)">
                        {new Date(entry.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, {entry.startTime}
                      </Mono>
                    </div>
                    {entry.notes && (
                      <Text size="sm" color="secondary" style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-wrap', lineHeight: 'var(--leading-relaxed)' }}>
                        {entry.notes}
                      </Text>
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
              <Mono size="xs" style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-4)', display: 'block' }}>
                Прошедшие занятия
              </Mono>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {pastEntries.map((entry) => (
                  <Card
                    key={entry.id}
                    variant="outlined"
                    padding="sm"
                    style={{ opacity: 0.6, borderLeft: '2px solid var(--color-border-subtle)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      <Text size="sm" weight="medium">{entry.lessonTitle}</Text>
                      <Mono size="xs" color="var(--color-text-tertiary)">
                        {new Date(entry.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, {entry.startTime}
                      </Mono>
                    </div>
                    {entry.notes && (
                      <Text size="xs" color="tertiary" style={{ marginTop: 'var(--space-1)', whiteSpace: 'pre-wrap' }}>
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
    </DashboardLayout>
  );
}

// ─── Inline icons ─────────────────────────────────────
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" /><rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h10v12H3z" /><path d="M6 2v12" /><path d="M6 5h4M6 8h4M6 11h4" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" /><path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" /><path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h12v9H5l-3 3V2z" /><path d="M5 6h6M5 9h3" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="10" height="13" rx="1" /><path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
    </svg>
  );
}
