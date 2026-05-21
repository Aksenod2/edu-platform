'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { getStreams, getAssignments, type Stream, type Assignment } from '@/lib/api';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Button, Badge, Text, Mono, Spinner } from '@platform/ui/atoms';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',      href: '/admin',           icon: <GridIcon /> },
      { label: 'Ученики',    href: '/admin/students',  icon: <UsersIcon /> },
      { label: 'Потоки',     href: '/admin/streams',   icon: <StreamIcon /> },
      { label: 'Расписание', href: '/admin/schedule',  icon: <CalendarIcon /> },
    ],
  },
];

type StreamWithAssignments = Stream & { assignments: Assignment[] };

export default function AssignmentsHubPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [streamsData, setStreamsData] = useState<StreamWithAssignments[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const { streams } = await getStreams(accessToken);
      const active = streams.filter((s) => s.status === 'active');
      const withAssignments = await Promise.all(
        active.map(async (stream) => {
          const { assignments } = await getAssignments(accessToken, stream.id);
          return { ...stream, assignments };
        }),
      );
      setStreamsData(withAssignments);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchData();
    }
  }, [accessToken, user, fetchData]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  const totalAssignments = streamsData.reduce((sum, s) => sum + s.assignments.length, 0);

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => { await logout(); router.push('/login'); },
        notificationBell: <NotificationBell />,
        platformName: 'PLATFORM ADMIN',
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
      <PageHeader
        title="Задания"
        subtitle={`Всего заданий: ${loadingData ? '...' : totalAssignments}`}
      />

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00' }}>
          {error}
        </div>
      )}

      {loadingData ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
          <Spinner size="md" />
        </div>
      ) : streamsData.length === 0 ? (
        <Text color="tertiary">Нет активных потоков. Создайте поток, чтобы добавлять задания.</Text>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
          }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-strong)' }}>
                {['Поток', 'Статус', 'Заданий', 'Действия'].map((h) => (
                  <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streamsData.map((stream) => (
                <tr key={stream.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-primary)' }}>
                    <Text size="sm" weight="medium" as="span">{stream.name}</Text>
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    <Badge variant="success">Активный</Badge>
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    <Mono size="xs">{stream.assignments.length}</Mono>
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/admin/streams/${stream.id}/assignments`)}
                    >
                      Управление заданиями
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" /><rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" /><path d="M1 14c0-3 2-5 5-5s5 2 5 5" /><circle cx="12" cy="4" r="2" /><path d="M15 13c0-2-1-4-3-4" />
    </svg>
  );
}
function StreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h10" />
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
