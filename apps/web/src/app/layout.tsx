import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { NotificationsProvider } from '@/lib/notifications-context';
import { PushManager } from '@/lib/push-manager';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeColorMeta } from '@/components/theme-color-meta';
import { PwaInstallPrompt } from '@/components/pwa-install-prompt';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'OCHOBA',
  description: 'Платформа для обмена заданиями и обратной связью',
  applicationName: 'OCHOBA',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'OCHOBA',
  },
  icons: {
    icon: ['/favicon.ico', { url: '/icon-32.png', type: 'image/png' }],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Статический дефолт под светлую тему; динамику по теме делает ThemeColorMeta.
  themeColor: '#ffffff',
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
                <ThemeColorMeta />
                <PushManager />
                <PwaInstallPrompt />
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
