'use client';

/**
 * NotificationBell — иконка колокольчика с бейджем и выпадающей панелью уведомлений.
 * Использует NotificationsContext. Рендерится в слоте header.notificationBell.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNotifications } from './notifications-context';
import { useAuth } from './auth-context';
import { getNotificationLink, type Notification, type NotificationType } from './api';

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const { user } = useAuth();
  const role = (user?.role === 'admin' ? 'admin' : 'student') as 'admin' | 'student';
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Закрываем панель при клике вне
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
  }, [markAllRead]);

  const displayCount = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        aria-label={`Уведомления${unreadCount > 0 ? ` (${displayCount} непрочитанных)` : ''}`}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          background: 'none',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-xs)',
          cursor: 'pointer',
          color: open ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
          transition: 'color var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)',
          borderColor: open ? 'var(--color-border-default)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
        }}
        onMouseLeave={(e) => {
          if (!open) (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
        }}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-accent-red)',
              color: '#fff',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 8,
              lineHeight: 1,
            }}
            aria-hidden
          >
            {displayCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkAllRead={handleMarkAllRead}
          onClose={() => setOpen(false)}
          role={role}
        />
      )}
    </div>
  );
}

interface NotificationPanelProps {
  notifications: Notification[];
  unreadCount: number;
  onMarkAllRead: () => Promise<void>;
  onClose: () => void;
  role: 'admin' | 'student';
}

function NotificationPanel({ notifications, unreadCount, onMarkAllRead, onClose, role }: NotificationPanelProps) {
  const [marking, setMarking] = useState(false);

  const handleMarkAllRead = async () => {
    setMarking(true);
    try {
      await onMarkAllRead();
    } finally {
      setMarking(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Уведомления"
      style={{
        position: 'absolute',
        top: 'calc(100% + var(--space-2))',
        right: 0,
        width: 360,
        maxHeight: 480,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 1000,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      }}
    >
      {/* Заголовок */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            letterSpacing: 'var(--tracking-widest)',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
          }}
        >
          УВЕДОМЛЕНИЯ
          {unreadCount > 0 && (
            <span
              style={{
                marginLeft: 'var(--space-2)',
                color: 'var(--color-accent-red)',
              }}
            >
              ({unreadCount > 99 ? '99+' : unreadCount})
            </span>
          )}
        </span>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={marking}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 'var(--tracking-wider)',
              textTransform: 'uppercase',
              color: 'var(--color-text-tertiary)',
              background: 'none',
              border: 'none',
              cursor: marking ? 'not-allowed' : 'pointer',
              padding: '2px 0',
              opacity: marking ? 0.5 : 1,
            }}
          >
            ПРОЧИТАТЬ ВСЕ
          </button>
        )}
      </div>

      {/* Список */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {notifications.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-8) var(--space-4)',
              gap: 'var(--space-3)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            <BellOffIcon />
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
          <>
            {notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} role={role} onNavigate={onClose} />
            ))}
            {notifications.length >= 50 && (
              <div
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  textAlign: 'center',
                  borderTop: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: 'var(--tracking-wider)',
                  textTransform: 'uppercase',
                }}
              >
                Показаны последние 50 уведомлений
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NotificationItem({ notification, role, onNavigate }: { notification: Notification; role: 'admin' | 'student'; onNavigate: () => void }) {
  const relativeTime = formatRelativeTime(notification.createdAt);
  const linkUrl = getNotificationLink(notification, role);

  const content = (
    <div
      style={{
        display: 'flex',
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
      {/* Индикатор непрочитанного */}
      <div style={{ flexShrink: 0, paddingTop: 4 }}>
        {notification.isRead ? (
          <NotificationTypeIcon type={notification.type} />
        ) : (
          <div style={{ position: 'relative' }}>
            <NotificationTypeIcon type={notification.type} />
            <span
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-accent-red)',
              }}
            />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: notification.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
            lineHeight: 'var(--leading-snug)',
            marginBottom: 'var(--space-1)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {notification.title}
        </p>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            letterSpacing: 'var(--tracking-wide)',
          }}
        >
          {relativeTime}
        </span>
      </div>
    </div>
  );

  if (linkUrl) {
    return (
      <a href={linkUrl} onClick={onNavigate} style={{ textDecoration: 'none', display: 'block' }}>
        {content}
      </a>
    );
  }
  return content;
}

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

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2.5a5.5 5.5 0 0 1 5.5 5.5c0 3 1.5 4 1.5 5H2s1.5-2 1.5-5A5.5 5.5 0 0 1 9 2.5z" />
      <path d="M7 15.5a2 2 0 0 0 4 0" />
      <path d="M9 2.5V1" />
    </svg>
  );
}

function BellOffIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
      <path d="M16 5a9 9 0 0 1 9 9c0 5 2.5 7 2.5 8H5s2.5-3 2.5-8A9 9 0 0 1 16 5z" />
      <path d="M12 25a4 4 0 0 0 8 0" />
    </svg>
  );
}

function NotificationTypeIcon({ type }: { type: NotificationType }) {
  const icons: Record<NotificationType, string> = {
    lesson_published: '📚',
    assignment_created: '📋',
    deadline_reminder: '⏰',
    thread_entry: '💬',
    assignment_reviewed: '✅',
    schedule_entry_created: '📅',
    assignment_submitted: '📤',
  };
  return (
    <span style={{ fontSize: 14, lineHeight: 1, display: 'block' }} aria-hidden>
      {icons[type] ?? '🔔'}
    </span>
  );
}
