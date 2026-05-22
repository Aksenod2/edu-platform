import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { NotificationsProvider } from '@/lib/notifications-context';
import { PushManager } from '@/lib/push-manager';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'OCHOBA',
  description: 'Платформа для обмена заданиями и обратной связью',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <AuthProvider>
            <NotificationsProvider>
              <TooltipProvider>
                <PushManager />
                {children}
                <Toaster />
              </TooltipProvider>
            </NotificationsProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
