'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { Separator } from '@/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/login');
    else if (user.role === 'admin') router.push('/admin');
    else if (user.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  if (loading || !user || user.role === 'admin') {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar role="student" />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        {/* min-w-0 + overflow-x-clip системно гасят горизонтальный «выезд» страницы
            на мобилке: случайно широкий контент (длинные строки, неперенесённые
            flex-ряды) обрезается, а намеренно широкие таблицы скроллятся в своих
            внутренних overflow-x-auto обёртках, не растягивая контейнер. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-clip overflow-y-auto p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
