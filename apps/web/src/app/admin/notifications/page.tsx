'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/lib/notifications-context';
import { PageHeader } from '@platform/ui/templates';
import { Badge } from '@platform/ui/atoms';
import {
  getNotificationLink,
  markNotificationRead,
  type Notification,
  type NotificationType,
} from '@/lib/api';
import { cn } from '@platform/ui/lib/utils';

export default function AdminNotificationsPage() {
  const { accessToken } = useAuth();
  const { notifications, unreadCount, markAllRead, refresh } = useNotifications();
  const router = useRouter();

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

  return (
    <>
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
    </>
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
