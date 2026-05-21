'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

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
      <div className="mb-8 px-5 py-4 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] flex items-center gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-full border border-[var(--color-border-strong)] flex items-center justify-center bg-[var(--color-bg-elevated)]">
          <span className="font-mono text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
            {user.name.split(' ').slice(0, 2).map((w) => w[0]).join('')}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-sans text-sm font-medium text-[var(--color-text-primary)] truncate">
            {user.name}
          </p>
          <p className="font-mono text-xs text-[var(--color-text-disabled)] uppercase tracking-widest mt-0.5">
            {user.role === 'student' ? 'Студент' : 'Администратор'}
          </p>
        </div>
      </div>

      {/* Settings grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SETTINGS_CARDS.map((card) => (
          <button
            key={card.href}
            onClick={() => router.push(card.href)}
            className="group text-left p-5 border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] transition-colors duration-150 focus:outline-none focus:border-[var(--color-accent-red)]"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-shrink-0 w-9 h-9 border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-secondary)] group-hover:border-[var(--color-accent-red)] group-hover:text-[var(--color-accent-red)] transition-colors">
                {card.icon}
              </div>
              {card.badge && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 border border-[var(--color-border-default)] text-[var(--color-text-disabled)] uppercase tracking-wider">
                  {card.badge}
                </span>
              )}
            </div>
            <h3 className="font-sans text-sm font-semibold text-[var(--color-text-primary)] mb-1.5">
              {card.title}
            </h3>
            <p className="font-sans text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {card.description}
            </p>
            <div className="mt-4 flex items-center gap-1.5 font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider group-hover:text-[var(--color-accent-red)] transition-colors">
              Открыть
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6h8M6 2l4 4-4 4" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      {/* Divider + metadata */}
      <div className="mt-10 pt-6 border-t border-[var(--color-border-subtle)]">
        <p className="font-mono text-xs text-[var(--color-text-disabled)] uppercase tracking-widest">
          Версия платформы — Nothing Design System
        </p>
      </div>
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
