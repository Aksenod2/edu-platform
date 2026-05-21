'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import {
  getStreams,
  getLessons,
  type Stream,
  type Lesson,
} from '@/lib/api';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card, CardBody } from '@platform/ui/molecules';
import { Button } from '@platform/ui/atoms';
import { Badge } from '@platform/ui/atoms';
import { Heading, Text, Mono } from '@platform/ui/atoms';
import { Spinner } from '@platform/ui/atoms';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',      href: '/dashboard',            icon: <GridIcon /> },
      { label: 'Уроки',      href: '/dashboard/lessons',    icon: <BookIcon /> },
      { label: 'Задания',    href: '/dashboard/assignments', icon: <ClipboardIcon /> },
      { label: 'Тред',       href: '/dashboard/thread',     icon: <ChatIcon /> },
      { label: 'Расписание', href: '/dashboard/schedule',   icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/dashboard/notifications', icon: <BellNavIcon /> },
      { label: 'Профиль',    href: '/dashboard/profile',    icon: <UserIcon /> },
    ],
  },
];

function StudentLessonsContent() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const streamIdParam = searchParams.get('streamId');

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(streamIdParam);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchStreams = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await getStreams(accessToken);
      setStreams(data.streams);
      if (!selectedStreamId && data.streams.length > 0) {
        setSelectedStreamId(data.streams[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков');
    }
  }, [accessToken, selectedStreamId]);

  const fetchLessons = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingData(true);
    try {
      const data = await getLessons(accessToken, selectedStreamId);
      setLessons(data.lessons);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки уроков');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') {
      fetchStreams();
    }
  }, [accessToken, user, fetchStreams]);

  useEffect(() => {
    if (selectedStreamId) {
      fetchLessons();
    }
  }, [selectedStreamId, fetchLessons]);

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
        user: { name: user.name, role: user.role as 'admin' | 'student' },
        onLogout: async () => { await logout(); router.push('/login'); },
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: STUDENT_NAV }}
    >
      <PageHeader
        title="Уроки"
        subtitle="Видеозаписи, конспекты, материалы"
        action={
          streams.length > 1 ? (
            <select
              value={selectedStreamId || ''}
              onChange={(e) => {
                setSelectedStreamId(e.target.value);
                setExpandedLessonId(null);
              }}
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

      {streams.length === 0 && !loadingData ? (
        <Text color="tertiary">Потоков пока нет.</Text>
      ) : loadingData ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
          <Spinner size="md" />
        </div>
      ) : lessons.length === 0 ? (
        <Text color="tertiary">В этом потоке пока нет доступных уроков.</Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {lessons.map((lesson) => {
            const isClosed = lesson.status === 'closed';
            const isExpanded = expandedLessonId === lesson.id;

            return (
              <Card
                key={lesson.id}
                variant="default"
                padding="none"
                style={{ opacity: isClosed ? 0.5 : 1 }}
              >
                <div
                  onClick={() => !isClosed && setExpandedLessonId(isExpanded ? null : lesson.id)}
                  style={{
                    padding: 'var(--space-4) var(--space-5)',
                    cursor: isClosed ? 'default' : 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <Heading level={3} size="md" style={{ margin: 0 }}>
                      {lesson.title}
                    </Heading>
                    {isClosed && (
                      <Badge variant="error">Недоступен</Badge>
                    )}
                  </div>
                  {!isClosed && (
                    <Mono size="xs" color="var(--color-text-tertiary)">
                      {isExpanded ? '▲' : '▼'}
                    </Mono>
                  )}
                </div>

                {isExpanded && !isClosed && (
                  <div style={{
                    padding: '0 var(--space-5) var(--space-5)',
                    borderTop: '1px solid var(--color-border-subtle)',
                  }}>
                    {lesson.videoUrl && (
                      <div style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                        <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                          <Button variant="primary" size="sm">
                            Смотреть видео
                          </Button>
                        </a>
                      </div>
                    )}

                    {lesson.summary && (
                      <div style={{ marginTop: 'var(--space-3)' }}>
                        <Heading level={4} size="sm" style={{ marginBottom: 'var(--space-2)' }}>Описание</Heading>
                        <Text size="sm" color="secondary" style={{ whiteSpace: 'pre-wrap', lineHeight: 'var(--leading-relaxed)' }}>
                          {lesson.summary}
                        </Text>
                      </div>
                    )}

                    {lesson.notes && (
                      <div style={{ marginTop: 'var(--space-4)' }}>
                        <Heading level={4} size="sm" style={{ marginBottom: 'var(--space-2)' }}>Конспект</Heading>
                        <Card variant="elevated" padding="sm">
                          <Text size="sm" color="secondary" style={{ whiteSpace: 'pre-wrap', lineHeight: 'var(--leading-relaxed)' }}>
                            {lesson.notes}
                          </Text>
                        </Card>
                      </div>
                    )}

                    {!lesson.videoUrl && !lesson.summary && !lesson.notes && (
                      <Text size="sm" color="tertiary" style={{ marginTop: 'var(--space-3)', fontStyle: 'italic' }}>
                        Контент пока не добавлен.
                      </Text>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}

export default function StudentLessonsPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    }>
      <StudentLessonsContent />
    </Suspense>
  );
}

// ─── Inline icons ─────────────────────────────────────
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

function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}
