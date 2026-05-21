'use client';

/**
 * NotificationBell — единственная точка входа для уведомлений.
 * Колокольчик с бейджем непрочитанных открывает правый drawer (shadcn Sheet).
 * Использует NotificationsContext. Рендерится в слоте header.
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useNotifications } from './notifications-context';
import { useAuth } from './auth-context';
import { getNotificationLink, markNotificationRead, type Notification } from './api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@platform/ui/lib/utils';

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead, refresh } = useNotifications();
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const role = (user?.role === 'admin' ? 'admin' : 'student') as 'admin' | 'student';
  const [open, setOpen] = useState(false);

  const displayCount = unreadCount > 99 ? '99+' : String(unreadCount);

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
  }, [markAllRead]);

  const handleSelect = useCallback(
    async (notification: Notification) => {
      if (accessToken && !notification.isRead) {
        await markNotificationRead(accessToken, notification.id);
        refresh();
      }
      const link = getNotificationLink(notification, role);
      setOpen(false);
      if (link) router.push(link);
    },
    [accessToken, refresh, role, router],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Уведомления${unreadCount > 0 ? ` (${displayCount} непрочитанных)` : ''}`}
        >
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
            >
              {displayCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="flex-row items-center justify-between gap-4 border-b">
          <SheetTitle>Уведомления</SheetTitle>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={handleMarkAllRead}
            className="mr-8"
          >
            Прочитать все
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Нет уведомлений
            </div>
          ) : (
            notifications.map((n, idx) => (
              <NotificationItem
                key={n.id}
                notification={n}
                isLast={idx === notifications.length - 1}
                onSelect={() => handleSelect(n)}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NotificationItem({
  notification,
  isLast,
  onSelect,
}: {
  notification: Notification;
  isLast: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent',
          !notification.isRead && 'bg-muted',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            notification.isRead ? 'bg-transparent' : 'bg-primary',
          )}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm leading-snug',
              notification.isRead ? 'font-normal text-foreground' : 'font-semibold text-foreground',
            )}
          >
            {notification.title}
          </p>
          {notification.body && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
          )}
          <span className="mt-1 block text-[10px] text-muted-foreground">
            {formatRelativeTime(notification.createdAt)}
          </span>
        </div>
      </button>
      {!isLast && <Separator />}
    </>
  );
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
