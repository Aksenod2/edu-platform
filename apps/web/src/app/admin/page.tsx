'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card, CardHeader, CardBody } from '@platform/ui/molecules';
import { Heading, Text, Mono } from '@platform/ui/atoms';
import { Spinner } from '@platform/ui/atoms';

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

export default function AdminPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => { await logout(); router.push('/login'); },
        platformName: 'PLATFORM ADMIN',
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
      <PageHeader
        title="Панель управления"
        subtitle="Управление учениками, потоками и расписанием"
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        <QuickCard title="Ученики"    description="Список и карточки учеников"        mono="STUDENTS" href="/admin/students" />
        <QuickCard title="Потоки"     description="Учебные группы и их уроки"          mono="STREAMS"  href="/admin/streams" />
        <QuickCard title="Расписание" description="Предстоящие занятия и сроки сдачи" mono="SCHEDULE" href="/admin/schedule" />
        <QuickCard title="Задания"    description="Управление заданиями (через потоки)"  mono="ASSIGNMENTS" href="/admin/assignments" />
      </div>
    </DashboardLayout>
  );
}

function QuickCard({ title, description, mono, href }: {
  title: string; description: string; mono: string; href: string;
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

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" />
      <path d="M15 13c0-2-1-4-3-4" />
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
      <rect x="1" y="3" width="14" height="12" />
      <path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}


function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3.5" />
      <path d="M8.5 8.5l5.5 5.5M11 11l1.5 1.5" />
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
