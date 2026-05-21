'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/lib/notifications-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Spinner, Badge } from '@platform/ui/atoms';
import {
  getNotificationLink,
  markNotificationRead,
  type Notification,
  type NotificationType,
} from '@/lib/api';
import { cn } from '@platform/ui/lib/utils';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',        href: '/admin',               icon: <GridIcon /> },
      { label: 'Ученики',      href: '/admin/students',      icon: <UsersIcon /> },
      { label: 'Потоки',       href: '/admin/streams',       icon: <StreamIcon /> },
      { label: 'Расписание',   href: '/admin/schedule',      icon: <CalendarIcon /> },
    ],
  },
  {
    label: 'Контент',
    items: [
      { label: 'Материалы',    href: '/admin/materials',     icon: <FolderIcon /> },
    ],
  },
  {
    label: 'Система',
    items: [
      { label: 'Уведомления',  href: '/admin/notifications', icon: <BellNavIcon /> },
      { label: 'API-ключи',    href: '/admin/api-keys',      icon: <KeyIcon /> },
      { label: 'Настройки',    href: '/admin/settings',      icon: <SettingsIcon /> },
    ],
  },
];

export default function AdminNotificationsPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const { notifications, unreadCount, loading: nLoading, markAllRead, refresh } = useNotifications();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard/notifications');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const handleNotificationClick = useCallback(
    async (notification: Notification) => {
      if (!accessToken) return;
      if (!notification.isRead) {
        await markNotificationRead(accessToken, notification.id);
        refresh();
      }
      const link = getNotificationLink(notification, 'admin');
      if (link) router.push(link);
    },
    [accessToken, router, refresh],
  );

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
  }, [markAllRead]);

  if (loading || nLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
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
        onLogout: async () => {
          await logout();
          router.push('/login');
        },
        platformName: 'PLATFORM ADMIN',
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
      <PageHeader
        title="Уведомления"
        subtitle={unreadCount > 0 ? `${unreadCount} непрочитанных` : 'Все прочитаны'}
        action={
          unreadCount > 0 ? (
            <button
              onClick={handleMarkAllRead}
              className={cn(
                'font-mono text-xs font-bold tracking-widest uppercase',
                'text-[var(--color-text-tertiary)]',
                'bg-transparent border border-[var(--color-border-default)]',
                'px-3 py-2 cursor-pointer',
                'hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-secondary)]',
                'transition-colors duration-[var(--duration-fast)]',
              )}
            >
              Отметить все прочитанными
            </button>
          ) : undefined
        }
      />

      {/* Stats row */}
      <div className="flex gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">Всего:</span>
          <span className="font-mono text-xs font-bold text-[var(--color-text-primary)]">{notifications.length}</span>
        </div>
        {unreadCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">
              Непрочитанных:
            </span>
            <Badge variant="error">{unreadCount}</Badge>
          </div>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-4xl opacity-20" aria-hidden>
            🔔
          </span>
          <span className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">
            Нет уведомлений
          </span>
        </div>
      ) : (
        <div className="border border-[var(--color-border-subtle)]">
          {notifications.map((n, idx) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onClick={() => handleNotificationClick(n)}
              role="admin"
              isLast={idx === notifications.length - 1}
            />
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}

function NotificationRow({
  notification,
  onClick,
  role,
  isLast,
}: {
  notification: Notification;
  onClick: () => void;
  role: 'admin' | 'student';
  isLast: boolean;
}) {
  const linkUrl = getNotificationLink(notification, role);

  return (
    <div
      onClick={onClick}
      role={linkUrl ? 'button' : undefined}
      tabIndex={linkUrl ? 0 : undefined}
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        !isLast && 'border-b border-[var(--color-border-subtle)]',
        notification.isRead ? 'bg-transparent' : 'bg-[var(--color-accent-red-dim)]',
        linkUrl && 'cursor-pointer',
        'hover:bg-[var(--color-bg-elevated)]',
        'transition-colors duration-[var(--duration-fast)]',
        'group',
      )}
    >
      {/* Icon + unread dot */}
      <div className="shrink-0 pt-0.5 flex flex-col items-center gap-1">
        <span className="text-base leading-none" aria-hidden>
          {NOTIFICATION_ICONS[notification.type] ?? '🔔'}
        </span>
        {!notification.isRead && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-red)]" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm leading-snug mb-1',
            notification.isRead
              ? 'font-normal text-[var(--color-text-secondary)]'
              : 'font-semibold text-[var(--color-text-primary)]',
          )}
        >
          {notification.title}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] leading-snug mb-1 line-clamp-2">
          {notification.body}
        </p>
        <span className="font-mono text-[10px] text-[var(--color-text-tertiary)] tracking-wide">
          {formatRelativeTime(notification.createdAt)}
        </span>
      </div>

      {/* Arrow */}
      {linkUrl && (
        <div className="shrink-0 pt-1 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 2l4 4-4 4" />
          </svg>
        </div>
      )}
    </div>
  );
}

const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  lesson_published: '📚',
  assignment_created: '📋',
  deadline_reminder: '⏰',
  thread_entry: '💬',
  assignment_reviewed: '✅',
  schedule_entry_created: '📅',
  assignment_submitted: '📤',
};

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч. назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} дн. назад`;
  return new Date(isoString).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

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
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4a1 1 0 011-1h4l2 2h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" />
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
function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3.5" />
      <path d="M8.5 8.5l5.5 5.5M11 11l1.5 1.5" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}
