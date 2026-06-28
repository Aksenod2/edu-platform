'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { initials } from '@/lib/initials';

interface SettingCard {
  title: string;
  description: string;
  href: string;
  badge?: string;
  icon: React.ReactNode;
}

const SETTINGS_CARDS: SettingCard[] = [
  {
    title: 'Уведомления',
    description: 'Email и push-уведомления. Управляйте категориями: обучение, дедлайны, обратная связь, расписание.',
    href: '/dashboard/settings/notifications',
    badge: 'ПУШИ',
    icon: <BellSettingIcon />,
  },
  {
    title: 'Безопасность',
    description: 'Изменение пароля и настройки безопасности аккаунта.',
    href: '/change-password',
    icon: <LockIcon />,
  },
];

export default function StudentSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  if (!user) return null;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
          <p className="text-sm text-muted-foreground">
            Управление аккаунтом и предпочтениями
          </p>
        </div>
      </div>

      {/* Account info strip */}
      <Card className="mb-8 mt-4">
        <CardContent className="flex items-center gap-4">
          <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full border bg-muted">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {initials(user.name)}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
            <p className="mt-0.5 text-xs uppercase tracking-widest text-muted-foreground">
              {user.role === 'student' ? 'Студент' : 'Администратор'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Settings grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SETTINGS_CARDS.map((card) => (
          <Card
            key={card.href}
            role="button"
            tabIndex={0}
            onClick={() => router.push(card.href)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                router.push(card.href);
              }
            }}
            className="group cursor-pointer transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CardContent>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors group-hover:text-foreground">
                  {card.icon}
                </div>
                {card.badge && <Badge variant="secondary">{card.badge}</Badge>}
              </div>
              <h3 className="mb-1.5 text-sm font-semibold text-foreground">{card.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{card.description}</p>
              <div className="mt-4 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground">
                Открыть
                <ArrowRight className="size-3" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Divider + metadata */}
      <Separator className="mt-10" />
      <p className="mt-6 text-xs uppercase tracking-widest text-muted-foreground">
        Версия платформы
      </p>
    </>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────
function BellSettingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 3a5 5 0 0 1 5 5c0 2.8 1.2 3.9 1.2 4.5H3.8s1.2-1.7 1.2-4.5A5 5 0 0 1 9 3z" />
      <path d="M7.2 14.5a1.8 1.8 0 0 0 3.6 0" />
      <path d="M9 3V1.5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="8" width="12" height="9" rx="1" />
      <path d="M6 8V6a3 3 0 0 1 6 0v2" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
