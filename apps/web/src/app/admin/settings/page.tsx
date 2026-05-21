'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Spinner, Button, Badge } from '@platform/ui/atoms';
import { cn } from '@platform/ui/lib/utils';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',        href: '/admin',               icon: <GridIcon /> },
      { label: 'Ученики',      href: '/admin/students',      icon: <UsersIcon /> },
      { label: 'Потоки',       href: '/admin/streams',       icon: <StreamIcon /> },
      { label: 'Расписание',   href: '/admin/schedule',      icon: <CalendarIcon /> },
    ],
  },
  {
    label: 'Контент',
    items: [
      { label: 'Материалы',    href: '/admin/materials',     icon: <FolderIcon /> },
    ],
  },
  {
    label: 'Система',
    items: [
      { label: 'Уведомления',  href: '/admin/notifications', icon: <BellNavIcon /> },
      { label: 'API-ключи',    href: '/admin/api-keys',      icon: <KeyIcon /> },
      { label: 'Настройки',    href: '/admin/settings',      icon: <SettingsIcon /> },
    ],
  },
];

interface SettingRow {
  label: string;
  value: string;
  mono?: boolean;
  badge?: string;
}

function SettingsSection({
  title,
  description,
  rows,
  footer,
}: {
  title: string;
  description?: string;
  rows: SettingRow[];
  footer?: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-[var(--color-text-tertiary)]">
          {title}
        </h2>
        {description && (
          <p className="mt-1 font-sans text-xs text-[var(--color-text-tertiary)]">{description}</p>
        )}
      </div>
      <div className="border border-[var(--color-border-default)]">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className={cn(
              'flex items-center justify-between px-4 py-3',
              idx < rows.length - 1 && 'border-b border-[var(--color-border-subtle)]',
            )}
          >
            <span className="font-sans text-sm text-[var(--color-text-secondary)]">{row.label}</span>
            <div className="flex items-center gap-2">
              {row.badge && <Badge variant="default">{row.badge}</Badge>}
              <span
                className={cn(
                  'text-sm',
                  row.mono ? 'font-mono text-xs text-[var(--color-text-tertiary)]' : 'font-sans text-[var(--color-text-primary)]',
                )}
              >
                {row.value}
              </span>
            </div>
          </div>
        ))}
        {footer && (
          <div className="px-4 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {footer}
          </div>
        )}
      </div>
    </section>
  );
}

export default function AdminSettingsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [buildTime] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => {
          await logout();
          router.push('/login');
        },
        platformName: 'PLATFORM ADMIN',
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
      <PageHeader
        title="Настройки"
        subtitle="Системная конфигурация платформы"
      />

      <SettingsSection
        title="Платформа"
        rows={[
          { label: 'Название', value: 'Обучающая платформа' },
          { label: 'Версия API', value: 'v1', mono: true },
          { label: 'Окружение', value: process.env.NODE_ENV ?? 'production', mono: true, badge: process.env.NODE_ENV === 'development' ? 'DEV' : undefined },
          { label: 'Последнее обновление страницы', value: buildTime, mono: true },
        ]}
      />

      <SettingsSection
        title="Аутентификация"
        description="Параметры сессий и безопасности"
        rows={[
          { label: 'Метод аутентификации', value: 'JWT + Refresh Token' },
          { label: 'Время жизни сессии', value: '15 мин (access) / 30 дней (refresh)', mono: true },
          { label: 'Хеширование паролей', value: 'bcrypt', mono: true },
          { label: 'Приглашения по email', value: 'Включено' },
        ]}
      />

      <SettingsSection
        title="Уведомления"
        description="Каналы доставки уведомлений"
        rows={[
          { label: 'Email-уведомления', value: 'Включено' },
          { label: 'Push-уведомления', value: 'Включено (Web Push)' },
          { label: 'Категории', value: 'урок / задание / дедлайн / тред', mono: true },
        ]}
        footer={
          <div className="flex items-center gap-3">
            <span className="font-sans text-xs text-[var(--color-text-tertiary)]">
              Настройки уведомлений для пользователей — в карточках учеников
            </span>
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin/notifications')}>
              Перейти
            </Button>
          </div>
        }
      />

      <SettingsSection
        title="Хранилище"
        description="S3-совместимое хранилище файлов (MinIO)"
        rows={[
          { label: 'Провайдер', value: 'MinIO (S3-compatible)', mono: true },
          { label: 'Загрузка файлов', value: 'Включено' },
          { label: 'Максимальный размер файла', value: '50 MB', mono: true },
          { label: 'Подписанные URL', value: 'Да, TTL 1 час', mono: true },
        ]}
      />

      <SettingsSection
        title="API-интеграция"
        description="Внешний доступ через API-ключи"
        rows={[
          { label: 'API-прокси', value: '/api-proxy', mono: true },
          { label: 'Аутентификация', value: 'Bearer token (API-ключ)' },
          { label: 'Управление ключами', value: 'В разделе API-ключи' },
        ]}
        footer={
          <div className="flex items-center gap-3">
            <span className="font-sans text-xs text-[var(--color-text-tertiary)]">
              Создать и управлять API-ключами
            </span>
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin/api-keys')}>
              Перейти
            </Button>
          </div>
        }
      />

      {/* Danger zone */}
      <section className="mb-8">
        <div className="mb-4">
          <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-[var(--color-error)]">
            Опасная зона
          </h2>
        </div>
        <div className="border border-[var(--color-error)] bg-[var(--color-error-dim)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-sans text-sm font-semibold text-[var(--color-text-primary)] mb-1">
                Сбросить данные платформы
              </p>
              <p className="font-sans text-xs text-[var(--color-text-tertiary)]">
                Необратимое удаление всех данных. Доступно только через прямой доступ к БД.
              </p>
            </div>
            <Badge variant="error">Только для суперадмина</Badge>
          </div>
        </div>
      </section>
    </DashboardLayout>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" />
      <rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" />
      <rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" />
      <path d="M15 13c0-2-1-4-3-4" />
    </svg>
  );
}
function StreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h10" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" />
      <path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4a1 1 0 011-1h4l2 2h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" />
    </svg>
  );
}
function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3.5" />
      <path d="M8.5 8.5l5.5 5.5M11 11l1.5 1.5" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}
