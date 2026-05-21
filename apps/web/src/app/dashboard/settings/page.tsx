'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',        href: '/dashboard',               icon: <GridIcon /> },
      { label: 'Уроки',        href: '/dashboard/lessons',       icon: <BookIcon /> },
      { label: 'Задания',      href: '/dashboard/assignments',   icon: <ClipboardIcon /> },
      { label: 'Тред',         href: '/dashboard/thread',        icon: <ChatIcon /> },
      { label: 'Расписание',   href: '/dashboard/schedule',      icon: <CalendarIcon /> },
      { label: 'Уведомления',  href: '/dashboard/notifications', icon: <BellNavIcon /> },
      { label: 'Материалы',    href: '/dashboard/materials',     icon: <FolderIcon /> },
      { label: 'Профиль',      href: '/dashboard/profile',       icon: <UserIcon /> },
      { label: 'Настройки',    href: '/dashboard/settings',      icon: <GearIcon /> },
    ],
  },
];

interface SettingCard {
  title: string;
  description: string;
  href: string;
  badge?: string;
  icon: React.ReactNode;
}

const SETTINGS_CARDS: SettingCard[] = [
  {
    title: 'Уведомления',
    description: 'Email и push-уведомления. Управляйте категориями: обучение, дедлайны, обратная связь, расписание.',
    href: '/dashboard/settings/notifications',
    badge: 'ПУШИ',
    icon: <BellSettingIcon />,
  },
  {
    title: 'Безопасность',
    description: 'Изменение пароля и настройки безопасности аккаунта.',
    href: '/change-password',
    icon: <LockIcon />,
  },
];

export default function StudentSettingsPage() {
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
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
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
        title="Настройки"
        subtitle="Управление аккаунтом и предпочтениями"
      />

      {/* Account info strip */}
      <div className="mb-8 px-5 py-4 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] flex items-center gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-full border border-[var(--color-border-strong)] flex items-center justify-center bg-[var(--color-bg-elevated)]">
          <span className="font-mono text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
            {user.name.split(' ').slice(0, 2).map((w) => w[0]).join('')}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-sans text-sm font-medium text-[var(--color-text-primary)] truncate">
            {user.name}
          </p>
          <p className="font-mono text-xs text-[var(--color-text-disabled)] uppercase tracking-widest mt-0.5">
            {user.role === 'student' ? 'Студент' : 'Администратор'}
          </p>
        </div>
      </div>

      {/* Settings grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SETTINGS_CARDS.map((card) => (
          <button
            key={card.href}
            onClick={() => router.push(card.href)}
            className="group text-left p-5 border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] transition-colors duration-150 focus:outline-none focus:border-[var(--color-accent-red)]"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-shrink-0 w-9 h-9 border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-secondary)] group-hover:border-[var(--color-accent-red)] group-hover:text-[var(--color-accent-red)] transition-colors">
                {card.icon}
              </div>
              {card.badge && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 border border-[var(--color-border-default)] text-[var(--color-text-disabled)] uppercase tracking-wider">
                  {card.badge}
                </span>
              )}
            </div>
            <h3 className="font-sans text-sm font-semibold text-[var(--color-text-primary)] mb-1.5">
              {card.title}
            </h3>
            <p className="font-sans text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {card.description}
            </p>
            <div className="mt-4 flex items-center gap-1.5 font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider group-hover:text-[var(--color-accent-red)] transition-colors">
              Открыть
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6h8M6 2l4 4-4 4" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      {/* Divider + metadata */}
      <div className="mt-10 pt-6 border-t border-[var(--color-border-subtle)]">
        <p className="font-mono text-xs text-[var(--color-text-disabled)] uppercase tracking-widest">
          Версия платформы — Nothing Design System
        </p>
      </div>
    </DashboardLayout>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
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
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" /><path d="M8 2.5V1" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4h5l2 2h7v8H1z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}
function BellSettingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 3a5 5 0 0 1 5 5c0 2.8 1.2 3.9 1.2 4.5H3.8s1.2-1.7 1.2-4.5A5 5 0 0 1 9 3z" />
      <path d="M7.2 14.5a1.8 1.8 0 0 0 3.6 0" />
      <path d="M9 3V1.5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="8" width="12" height="9" rx="1" />
      <path d="M6 8V6a3 3 0 0 1 6 0v2" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
