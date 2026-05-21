'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import {
  getNotifications,
  markAllNotificationsRead,
  type Notification,
} from './api';

interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const POLL_INTERVAL_MS = 30_000;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { accessToken, user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await getNotifications(accessToken);
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Тихий сбой — не ломаем UI из-за уведомлений
    }
  }, [accessToken]);

  const markAllRead = useCallback(async () => {
    if (!accessToken) return;
    try {
      await markAllNotificationsRead(accessToken);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Тихий сбой
    }
  }, [accessToken]);

  useEffect(() => {
    if (!user || !accessToken) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    setLoading(true);
    refresh().finally(() => setLoading(false));

    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user, accessToken, refresh]);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, loading, markAllRead, refresh }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
