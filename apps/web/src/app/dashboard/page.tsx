'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card, CardHeader, CardBody } from '@platform/ui/molecules';
import { Heading, Text, Mono } from '@platform/ui/atoms';
import { Spinner } from '@platform/ui/atoms';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',      href: '/dashboard',          icon: <GridIcon /> },
      { label: 'Уроки',      href: '/dashboard/lessons',  icon: <BookIcon /> },
      { label: 'Задания',    href: '/dashboard/assignments', icon: <ClipboardIcon /> },
      { label: 'Тред',       href: '/dashboard/thread',   icon: <ChatIcon /> },
      { label: 'Расписание', href: '/dashboard/schedule', icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/dashboard/notifications', icon: <BellNavIcon /> },
      { label: 'Профиль',   href: '/dashboard/profile',  icon: <UserIcon /> },
      { label: 'Настройки', href: '/dashboard/settings/notifications', icon: <GearIcon /> },
    ],
  },
];

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
    if (!loading && user?.role === 'student' && user.questionnaireCompleted === false) {
      router.push('/dashboard/profile');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

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
        title={`Привет, ${user.name.split(' ')[0]}`}
        subtitle="Ваш учебный дашборд"
      />

      {/* Быстрые ссылки */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        <QuickCard
          title="Уроки"
          description="Видеозаписи, конспекты, материалы"
          mono="LESSONS"
          href="/dashboard/lessons"
        />
        <QuickCard
          title="Задания"
          description="Назначенные задания и их статусы"
          mono="ASSIGNMENTS"
          href="/dashboard/assignments"
        />
        <QuickCard
          title="Тред"
          description="Записи, файлы, обратная связь"
          mono="THREAD"
          href="/dashboard/thread"
        />
        <QuickCard
          title="Расписание"
          description="Предстоящие занятия и сроки"
          mono="SCHEDULE"
          href="/dashboard/schedule"
        />
        <QuickCard
          title="Профиль"
          description="Анкета и контактные данные"
          mono="PROFILE"
          href="/dashboard/profile"
        />
      </div>
    </DashboardLayout>
  );
}

function QuickCard({
  title,
  description,
  mono,
  href,
}: {
  title: string;
  description: string;
  mono: string;
  href: string;
}) {
  return (
    <a href={href} style={{ textDecoration: 'none' }}>
      <Card interactive padding="md">
        <CardHeader>
          <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', letterSpacing: 'var(--tracking-widest)' }}>
            {mono}
          </Mono>
        </CardHeader>
        <CardBody>
          <Heading level={3} size="lg" style={{ marginBottom: 'var(--space-2)' }}>{title}</Heading>
          <Text size="sm" color="tertiary">{description}</Text>
        </CardBody>
      </Card>
    </a>
  );
}

// Inline иконки — минималистичные SVG в стиле Nothing
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

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h12v9H5l-3 3V2z" />
      <path d="M5 6h6M5 9h3" />
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

function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
    </svg>
  );
}
