'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/lib/notifications-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';
import {
  getNotificationLink,
  markNotificationRead,
  type Notification,
  type NotificationType,
} from '@/lib/api';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',        href: '/admin',               icon: <GridIcon /> },
      { label: 'Ученики',      href: '/admin/students',      icon: <UsersIcon /> },
      { label: 'Потоки',       href: '/admin/streams',       icon: <StreamIcon /> },
      { label: 'Расписание',   href: '/admin/schedule',      icon: <CalendarIcon /> },
      { label: 'Уведомления',  href: '/admin/notifications', icon: <BellNavIcon /> },
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

  const handleNotificationClick = useCallback(async (notification: Notification) => {
    if (!accessToken) return;
    if (!notification.isRead) {
      await markNotificationRead(accessToken, notification.id);
      refresh();
    }
    const link = getNotificationLink(notification, 'admin');
    if (link) router.push(link);
  }, [accessToken, router, refresh]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
  }, [markAllRead]);

  if (loading || nLoading) {
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
        title="Уведомления"
        subtitle={unreadCount > 0 ? `${unreadCount} непрочитанных` : 'Все прочитаны'}
      />

      {unreadCount > 0 && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <button
            onClick={handleMarkAllRead}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              fontWeight: 700,
              letterSpacing: 'var(--tracking-wider)',
              textTransform: 'uppercase',
              color: 'var(--color-text-tertiary)',
              background: 'none',
              border: '1px solid var(--color-border-default)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: 'pointer',
            }}
          >
            ОТМЕТИТЬ ВСЕ ПРОЧИТАННЫМИ
          </button>
        </div>
      )}

      {notifications.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-12) var(--space-4)',
            gap: 'var(--space-3)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <span style={{ fontSize: 32, opacity: 0.3 }}>🔔</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
            }}
          >
            Нет уведомлений
          </span>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--color-border-subtle)' }}>
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onClick={() => handleNotificationClick(n)}
              role="admin"
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
}: {
  notification: Notification;
  onClick: () => void;
  role: 'admin' | 'student';
}) {
  const linkUrl = getNotificationLink(notification, role);

  return (
    <div
      onClick={onClick}
      role={linkUrl ? 'link' : undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: notification.isRead ? 'transparent' : 'rgba(255,59,48,0.04)',
        cursor: linkUrl ? 'pointer' : 'default',
        transition: 'background var(--duration-fast) var(--ease-default)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-elevated)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = notification.isRead
          ? 'transparent'
          : 'rgba(255,59,48,0.04)';
      }}
    >
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <span style={{ fontSize: 16, lineHeight: 1, display: 'block' }} aria-hidden>
          {NOTIFICATION_ICONS[notification.type] ?? '🔔'}
        </span>
        {!notification.isRead && (
          <span
            style={{
              display: 'block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-accent-red)',
              margin: '4px auto 0',
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: notification.isRead ? 400 : 600,
            color: notification.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
            lineHeight: 'var(--leading-snug)',
            marginBottom: 'var(--space-1)',
          }}
        >
          {notification.title}
        </p>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            lineHeight: 'var(--leading-snug)',
            marginBottom: 'var(--space-1)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {notification.body}
        </p>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            letterSpacing: 'var(--tracking-wide)',
          }}
        >
          {formatRelativeTime(notification.createdAt)}
        </span>
      </div>

      {linkUrl && (
        <div style={{ flexShrink: 0, paddingTop: 4, color: 'var(--color-text-tertiary)' }}>
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

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" /><path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" /><path d="M15 13c0-2-1-4-3-4" />
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
function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" /><path d="M8 2.5V1" />
    </svg>
  );
}
