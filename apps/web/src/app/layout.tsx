import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { NotificationsProvider } from '@/lib/notifications-context';
import { PushManager } from '@/lib/push-manager';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'OCHOBA',
  description: 'Платформа для обмена заданиями и обратной связью',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AuthProvider>
          <NotificationsProvider>
            <PushManager />
            {children}
            <Toaster />
          </NotificationsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
