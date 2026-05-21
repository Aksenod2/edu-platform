'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { STUDENT_NAV } from '@/lib/student-nav';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';
import Link from 'next/link';

const QUICK_LINKS = [
  {
    title: 'Уроки',
    description: 'Видеозаписи, конспекты, материалы',
    tag: 'LESSONS',
    href: '/dashboard/lessons',
  },
  {
    title: 'Задания',
    description: 'Назначенные задания и их статусы',
    tag: 'ASSIGNMENTS',
    href: '/dashboard/assignments',
  },
  {
    title: 'Тред',
    description: 'Записи, файлы, обратная связь',
    tag: 'THREAD',
    href: '/dashboard/thread',
  },
  {
    title: 'Расписание',
    description: 'Предстоящие занятия и сроки',
    tag: 'SCHEDULE',
    href: '/dashboard/schedule',
  },
  {
    title: 'Профиль',
    description: 'Анкета и контактные данные',
    tag: 'PROFILE',
    href: '/dashboard/profile',
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
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  const firstName = user.name.split(' ')[0];

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: user.role as 'admin' | 'student' },
        onLogout: async () => {
          await logout();
          router.push('/login');
        },
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: STUDENT_NAV }}
    >
      {/* Page header */}
      <div className="mb-10">
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-[var(--color-text-tertiary)] mb-2">
          STUDENT DASHBOARD
        </p>
        <h1 className="font-sans text-3xl font-bold tracking-tight text-[var(--color-text-primary)] leading-tight">
          Привет, {firstName}
        </h1>
        <p className="font-sans text-sm text-[var(--color-text-tertiary)] mt-1">Ваш учебный дашборд</p>
      </div>

      {/* Quick links grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {QUICK_LINKS.map((link) => (
          <QuickCard key={link.href} {...link} />
        ))}
      </div>
    </DashboardLayout>
  );
}

function QuickCard({
  title,
  description,
  tag,
  href,
}: {
  title: string;
  description: string;
  tag: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5 no-underline transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-elevated)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-red)]"
    >
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[var(--color-text-tertiary)] mb-3">
        {tag}
      </p>
      <h3 className="font-sans text-lg font-semibold text-[var(--color-text-primary)] tracking-tight mb-2 group-hover:text-white transition-colors">
        {title}
      </h3>
      <p className="font-sans text-sm text-[var(--color-text-tertiary)] leading-relaxed">{description}</p>
      <div className="mt-4 flex items-center gap-1 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-accent-red)] transition-colors">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M2 6h8M7 3l3 3-3 3" />
        </svg>
      </div>
    </Link>
  );
}
