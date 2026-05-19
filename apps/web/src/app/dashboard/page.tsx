'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
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
      { label: 'Расписание', href: '/dashboard/schedule', icon: <CalendarIcon /> },
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
          title="Расписание"
          description="Предстоящие занятия и сроки"
          mono="SCHEDULE"
          href="/dashboard/schedule"
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
