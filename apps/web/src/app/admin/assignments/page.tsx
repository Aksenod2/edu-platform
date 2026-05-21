'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { getStreams, getAssignments, type Stream, type Assignment } from '@/lib/api';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Button, Badge, Spinner, Mono } from '@platform/ui/atoms';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',      href: '/admin',           icon: <GridIcon /> },
      { label: 'Ученики',    href: '/admin/students',  icon: <UsersIcon /> },
      { label: 'Потоки',     href: '/admin/streams',   icon: <StreamIcon /> },
      { label: 'Расписание', href: '/admin/schedule',  icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/admin/notifications', icon: <BellNavIcon /> },
      { label: 'API-доступ', href: '/admin/api-access', icon: <KeyIcon /> },
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
    if (accessToken && user?.role === 'admin') fetchData();
  }, [accessToken, user, fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
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
        <div className="px-4 py-3 mb-4 rounded-[var(--radius-xs)] border border-[var(--color-error)] bg-[var(--color-error-dim)] text-[var(--color-error)] text-sm">
          {error}
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : streamsData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Mono size="xs" className="text-[var(--color-text-tertiary)] tracking-[var(--tracking-widest)] mb-3">ПУСТО</Mono>
          <p className="text-[var(--color-text-tertiary)] text-sm">Нет активных потоков. Создайте поток, чтобы добавлять задания.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                {['Поток', 'Статус', 'Заданий', 'Действия'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[var(--color-text-tertiary)] font-mono text-xs uppercase tracking-[var(--tracking-wider)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streamsData.map((stream) => (
                <tr key={stream.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface)] transition-colors">
                  <td className="px-4 py-3 text-[var(--color-text-primary)] font-medium">{stream.name}</td>
                  <td className="px-4 py-3"><Badge variant="success">Активный</Badge></td>
                  <td className="px-4 py-3"><Mono size="xs" className="text-[var(--color-text-secondary)]">{stream.assignments.length}</Mono></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => router.push(`/admin/streams/${stream.id}/assignments`)}>
                        Управление
                      </Button>
                    </div>
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

function GridIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" /><rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" /></svg>; }
function UsersIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="5" r="3" /><path d="M1 14c0-3 2-5 5-5s5 2 5 5" /><circle cx="12" cy="4" r="2" /><path d="M15 13c0-2-1-4-3-4" /></svg>; }
function StreamIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h8M2 12h10" /></svg>; }
function CalendarIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="14" height="12" /><path d="M1 7h14M5 1v4M11 1v4" /></svg>; }
function KeyIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="3.5" /><path d="M8.5 8.5l5.5 5.5M11 11l1.5 1.5" /></svg>; }
function BellNavIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" /><path d="M6.5 13a1.5 1.5 0 0 0 3 0" /><path d="M8 2.5V1" /></svg>; }
