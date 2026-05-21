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
      { label: 'Профиль',      href: '/dashboard/profile',       icon: <UserIcon /> },
      { label: 'Настройки',    href: '/dashboard/settings/notifications', icon: <GearIcon /> },
    ],
  },
];

export default function StudentNotificationsPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const { notifications, unreadCount, loading: nLoading, markAllRead, refresh } = useNotifications();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin/notifications');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const handleNotificationClick = useCallback(async (notification: Notification) => {
    if (!accessToken) return;
    if (!notification.isRead) {
      await markNotificationRead(accessToken, notification.id);
      refresh();
    }
    const link = getNotificationLink(notification, 'student');
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
              role="student"
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
      {/* Indicator */}
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

      {/* Content */}
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

      {/* Arrow */}
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

// Inline icons
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
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
    </svg>
  );
}
