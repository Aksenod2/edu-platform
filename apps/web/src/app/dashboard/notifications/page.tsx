'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/lib/notifications-context';
import { NotificationBell } from '@/lib/notification-bell';
import { STUDENT_NAV } from '@/lib/student-nav';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';
import {
  getNotificationLink,
  markNotificationRead,
  type Notification,
  type NotificationType,
} from '@/lib/api';
import Link from 'next/link';

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

  const handleNotificationClick = useCallback(
    async (notification: Notification) => {
      if (!accessToken) return;
      if (!notification.isRead) {
        await markNotificationRead(accessToken, notification.id);
        refresh();
      }
      const link = getNotificationLink(notification, 'student');
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

  if (!user) return null;

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
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 font-mono text-xs tracking-wide text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors mb-3 no-underline"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M9 2L4 7l5 5" />
          </svg>
          Назад
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-sans text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              Уведомления
            </h1>
            <p className="font-mono text-xs tracking-wide text-[var(--color-text-tertiary)] mt-1">
              {unreadCount > 0 ? `${unreadCount} непрочитанных` : 'Все прочитаны'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="font-mono text-xs font-bold tracking-wider uppercase text-[var(--color-text-tertiary)] bg-transparent border border-[var(--color-border-default)] px-3 py-2 cursor-pointer hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Отметить все прочитанными
            </button>
          )}
        </div>
      </div>

      {/* Notification list */}
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--color-text-tertiary)]">
          <svg
            width="32"
            height="32"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="opacity-30"
          >
            <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
            <path d="M6.5 13a1.5 1.5 0 0 0 3 0M8 2.5V1" />
          </svg>
          <span className="font-mono text-xs tracking-widest uppercase">Нет уведомлений</span>
        </div>
      ) : (
        <div className="border border-[var(--color-border-subtle)]">
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
      className="flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors hover:bg-[var(--color-bg-elevated)]"
      style={{
        background: notification.isRead ? 'transparent' : 'rgba(255,59,48,0.04)',
        cursor: linkUrl ? 'pointer' : 'default',
      }}
    >
      {/* Icon + unread dot */}
      <div className="shrink-0 pt-0.5">
        <span className="text-base leading-none block" aria-hidden>
          {NOTIFICATION_ICONS[notification.type] ?? '🔔'}
        </span>
        {!notification.isRead && (
          <span className="block w-1.5 h-1.5 rounded-full bg-[var(--color-accent-red)] mx-auto mt-1" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className="font-sans text-sm leading-snug mb-1"
          style={{
            fontWeight: notification.isRead ? 400 : 600,
            color: notification.isRead
              ? 'var(--color-text-secondary)'
              : 'var(--color-text-primary)',
          }}
        >
          {notification.title}
        </p>
        <p
          className="font-sans text-xs text-[var(--color-text-tertiary)] leading-snug mb-1 overflow-hidden"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {notification.body}
        </p>
        <span className="font-mono text-[10px] text-[var(--color-text-tertiary)] tracking-wide">
          {formatRelativeTime(notification.createdAt)}
        </span>
      </div>

      {/* Arrow */}
      {linkUrl && (
        <div className="shrink-0 pt-1 text-[var(--color-text-tertiary)]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 2l4 4-4 4" />
          </svg>
        </div>
      )}
    </div>
  );
}
