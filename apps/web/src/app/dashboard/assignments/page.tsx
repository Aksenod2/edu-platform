'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner, Button, Badge } from '@platform/ui/atoms';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',      href: '/dashboard',             icon: <GridIcon /> },
      { label: 'Уроки',      href: '/dashboard/lessons',     icon: <BookIcon /> },
      { label: 'Задания',    href: '/dashboard/assignments', icon: <ClipboardIcon /> },
      { label: 'Тред',       href: '/dashboard/thread',      icon: <ChatIcon /> },
      { label: 'Расписание', href: '/dashboard/schedule',    icon: <CalendarIcon /> },
      { label: 'Профиль',    href: '/dashboard/profile',     icon: <UserIcon /> },
    ],
  },
];
import {
  getStudentAssignments,
  updateStudentAssignment,
  getStreams,
  type StudentAssignment,
  type Stream,
} from '@/lib/api';

const statusLabels: Record<string, string> = {
  assigned: 'Назначено',
  submitted: 'Отправлено',
  reviewed: 'Проверено',
};

const statusBadgeVariant: Record<string, 'warning' | 'info' | 'success'> = {
  assigned: 'warning',
  submitted: 'info',
  reviewed: 'success',
};

const typeLabels: Record<string, string> = {
  short: 'Короткое',
  long: 'Длинное',
};

export default function StudentAssignmentsPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [streamFilter, setStreamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Expanded assignment
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const params: { streamId?: string; status?: string } = {};
      if (streamFilter) params.streamId = streamFilter;
      if (statusFilter) params.status = statusFilter;

      const [saData, streamsData] = await Promise.all([
        getStudentAssignments(accessToken, params),
        getStreams(accessToken),
      ]);
      setAssignments(saData.studentAssignments);
      setStreams(streamsData.streams.filter((s) => s.status === 'active'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, streamFilter, statusFilter]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') {
      fetchData();
    }
  }, [accessToken, user, fetchData]);

  const handleSubmit = async (saId: string) => {
    if (!accessToken) return;
    if (!confirm('Отправить задание на проверку?')) return;
    setError('');
    setSuccess('');
    try {
      await updateStudentAssignment(accessToken, saId, { status: 'submitted' });
      setSuccess('Задание отправлено на проверку');
      setTimeout(() => setSuccess(''), 3000);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (!user || user.role !== 'student') return null;

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'student' },
        onLogout: async () => { await logout(); router.push('/login'); },
      }}
      sidebar={{ sections: STUDENT_NAV }}
    >
    <div style={{ padding: 'var(--space-4)', maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard')}
            style={{ marginBottom: 8, display: 'block' }}
          >
            ← Назад
          </Button>
          <h1 style={{ margin: 0 }}>Мои задания</h1>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00', userSelect: 'text', cursor: 'text' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: 12, background: 'var(--color-success-dim)', border: '1px solid var(--color-success)', borderRadius: 4, marginBottom: 16, color: 'var(--color-success)' }}>
          {success}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          value={streamFilter}
          onChange={(e) => setStreamFilter(e.target.value)}
          style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
        >
          <option value="">Все потоки</option>
          {streams.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
        >
          <option value="">Все статусы</option>
          <option value="assigned">Назначено</option>
          <option value="submitted">Отправлено</option>
          <option value="reviewed">Проверено</option>
        </select>
      </div>

      {loadingData ? (
        <p>Загрузка заданий...</p>
      ) : assignments.length === 0 ? (
        <p style={{ color: '#666' }}>
          {statusFilter || streamFilter ? 'Нет заданий по выбранным фильтрам.' : 'У вас пока нет назначенных заданий.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {assignments.map((sa) => {
            const a = sa.assignment;
            const isExpanded = expandedId === sa.id;
            return (
              <div
                key={sa.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: 'var(--color-bg-surface)',
                }}
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : sa.id)}
                  style={{
                    padding: '16px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: isExpanded ? 'var(--color-bg-elevated)' : 'var(--color-bg-surface)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 16 }}>{a?.title}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge variant={statusBadgeVariant[sa.status] ?? 'default'}>
                        {statusLabels[sa.status]}
                      </Badge>
                      {a?.type && (
                        <Badge variant="default">{typeLabels[a.type]}</Badge>
                      )}
                      {a?.stream && (
                        <span style={{ fontSize: 12, color: '#666' }}>{a.stream.name}</span>
                      )}
                      {a?.lesson && (
                        <span style={{ fontSize: 12, color: '#999' }}>Урок: {a.lesson.title}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {a?.dueDate && (
                      <div style={{ fontSize: 13, color: new Date(a.dueDate) < new Date() ? '#c00' : '#666', textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: '#999' }}>Дедлайн</div>
                        {new Date(a.dueDate).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    )}
                    <span style={{ fontSize: 18, color: '#999' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 20px 16px', borderTop: '1px solid #eee' }}>
                    {a?.description ? (
                      <div style={{ marginTop: 12 }}>
                        <strong style={{ fontSize: 13 }}>Описание:</strong>
                        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0 0', fontSize: 14, lineHeight: 1.5 }}>
                          {a.description}
                        </pre>
                      </div>
                    ) : (
                      <p style={{ color: '#999', fontSize: 13, marginTop: 12 }}>Описание не указано.</p>
                    )}

                    {a?.tags && a.tags.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {a.tags.map((tag) => (
                          <span key={tag} style={{ fontSize: 11, background: '#e8e8e8', padding: '1px 6px', borderRadius: 8 }}>{tag}</span>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: '#666' }}>
                      {sa.submittedAt && (
                        <span>Отправлено: {new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      )}
                      {sa.reviewedAt && (
                        <span>Проверено: {new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      )}
                    </div>

                    {sa.status === 'assigned' && (
                      <div style={{ marginTop: 16 }}>
                        <Button
                          variant="primary"
                          onClick={() => handleSubmit(sa.id)}
                        >
                          Отправить на проверку
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </DashboardLayout>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" />
      <rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" />
      <rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h10v12H3z" />
      <path d="M6 2v12" />
      <path d="M6 5h4M6 8h4M6 11h4" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="10" height="13" rx="1" />
      <path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h12v9H5l-3 3V2z" />
      <path d="M5 6h6M5 9h3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" />
      <path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}
