'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { getPushPermissionStatus } from '@/lib/push';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreference,
  type NotificationCategory,
} from '@/lib/api';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card, CardBody } from '@platform/ui/molecules';
import { Mono, Text, Heading } from '@platform/ui/atoms';
import { Spinner } from '@platform/ui/atoms';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',      href: '/dashboard',                            icon: <GridIcon /> },
      { label: 'Уроки',      href: '/dashboard/lessons',                    icon: <BookIcon /> },
      { label: 'Задания',    href: '/dashboard/assignments',                 icon: <ClipboardIcon /> },
      { label: 'Тред',       href: '/dashboard/thread',                      icon: <ChatIcon /> },
      { label: 'Расписание', href: '/dashboard/schedule',                   icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/dashboard/notifications', icon: <BellIcon /> },
      { label: 'Профиль',   href: '/dashboard/profile',                    icon: <UserIcon /> },
      { label: 'Настройки', href: '/dashboard/settings/notifications',      icon: <BellIcon /> },
    ],
  },
];

interface CategoryRow {
  category: NotificationCategory;
  label: string;
  description: string;
  roles: ('student' | 'admin')[];
  system: boolean;
}

const CATEGORY_ROWS: CategoryRow[] = [
  {
    category: 'learning',
    label: 'Учебный процесс',
    description: 'Новые уроки и задания в потоке',
    roles: ['student'],
    system: false,
  },
  {
    category: 'deadlines',
    label: 'Дедлайны',
    description: 'Напоминания о сроках сдачи заданий',
    roles: ['student'],
    system: false,
  },
  {
    category: 'feedback',
    label: 'Обратная связь',
    description: 'Ответы в тредах, проверка заданий',
    roles: ['student', 'admin'],
    system: false,
  },
  {
    category: 'schedule',
    label: 'Расписание',
    description: 'Новые события в расписании потока',
    roles: ['student'],
    system: false,
  },
  {
    category: 'student_activity',
    label: 'Активность студентов',
    description: 'Сдача заданий студентами',
    roles: ['admin'],
    system: false,
  },
  {
    category: 'system',
    label: 'Системные',
    description: 'Приглашения, сброс пароля — нельзя отключить',
    roles: ['student', 'admin'],
    system: true,
  },
];

export default function NotificationSettingsPage() {
  const { user, accessToken, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pushStatus, setPushStatus] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
    if (!authLoading && user?.mustChangePassword) router.push('/change-password');
  }, [user, authLoading, router]);

  useEffect(() => {
    setPushStatus(getPushPermissionStatus());
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    getNotificationPreferences(accessToken)
      .then((data) => setPrefs(data.preferences))
      .catch(() => setPrefs([]))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const getPref = useCallback(
    (category: NotificationCategory): NotificationPreference | undefined =>
      prefs.find((p) => p.category === category),
    [prefs],
  );

  const handleToggle = useCallback(
    (category: NotificationCategory, channel: 'channelEmail' | 'channelPush', value: boolean) => {
      setPrefs((prev) => {
        const existing = prev.find((p) => p.category === category);
        if (existing) {
          return prev.map((p) =>
            p.category === category ? { ...p, [channel]: value } : p,
          );
        }
        // Создаём локально, если не пришло с сервера
        return [
          ...prev,
          {
            id: `local-${category}`,
            userId: user?.id ?? '',
            category,
            channelEmail: channel === 'channelEmail' ? value : true,
            channelPush: channel === 'channelPush' ? value : true,
            updatedAt: new Date().toISOString(),
          },
        ];
      });
      setSaveSuccess(false);
      setSaveError(null);
    },
    [user],
  );

  const handleGlobalToggle = useCallback(
    (enabled: boolean) => {
      setPrefs((prev) =>
        CATEGORY_ROWS.filter((r) => !r.system).map((r) => {
          const existing = prev.find((p) => p.category === r.category);
          return {
            id: existing?.id ?? `local-${r.category}`,
            userId: user?.id ?? '',
            category: r.category,
            channelEmail: enabled,
            channelPush: enabled,
            updatedAt: new Date().toISOString(),
          };
        }),
      );
      setSaveSuccess(false);
      setSaveError(null);
    },
    [user],
  );

  const handleSave = useCallback(async () => {
    if (!accessToken) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updates = prefs
        .filter((p) => p.category !== 'system')
        .map((p) => ({
          category: p.category,
          channelEmail: p.channelEmail,
          channelPush: p.channelPush,
        }));
      const data = await updateNotificationPreferences(accessToken, updates);
      setPrefs(data.preferences);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [accessToken, prefs]);

  const allEmailOff = CATEGORY_ROWS.filter((r) => !r.system).every((r) => {
    const p = getPref(r.category);
    return p ? !p.channelEmail : false;
  });
  const allPushOff = CATEGORY_ROWS.filter((r) => !r.system).every((r) => {
    const p = getPref(r.category);
    return p ? !p.channelPush : false;
  });
  const globalOff = allEmailOff && allPushOff;

  if (authLoading || loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  const visibleRows = CATEGORY_ROWS.filter((r) => r.roles.includes(user.role as 'student' | 'admin'));

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: user.role as 'admin' | 'student' },
        onLogout: async () => { await logout(); router.push('/login'); },
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: STUDENT_NAV }}
    >
      <PageHeader
        title="Настройки уведомлений"
        subtitle="Управляйте тем, какие уведомления и по каким каналам вы получаете"
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {saveError && (
              <Mono size="xs" style={{ color: 'var(--color-error)' }}>{saveError}</Mono>
            )}
            {saveSuccess && (
              <Mono size="xs" style={{ color: 'var(--color-success)' }}>СОХРАНЕНО</Mono>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                fontWeight: 700,
                letterSpacing: 'var(--tracking-widest)',
                textTransform: 'uppercase',
                padding: 'var(--space-2) var(--space-4)',
                background: 'var(--color-accent-red)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-xs)',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'СОХРАНЕНИЕ...' : 'СОХРАНИТЬ'}
            </button>
          </div>
        }
      />

      {/* Web Push status banner */}
      {pushStatus === 'denied' && (
        <div
          style={{
            marginBottom: 'var(--space-6)',
            padding: 'var(--space-4)',
            background: 'var(--color-warning-dim)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div>
            <Mono size="xs" style={{ color: 'var(--color-warning)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', display: 'block', marginBottom: 'var(--space-1)' }}>
              Push-уведомления заблокированы браузером
            </Mono>
            <Text size="sm" color="secondary">
              Вы ранее отклонили разрешение на push-уведомления. Чтобы включить их, зайдите в настройки браузера → сайт → Уведомления → «Разрешить».
            </Text>
          </div>
        </div>
      )}

      {/* Global toggle */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
            <div>
              <Heading level={3} size="md" style={{ marginBottom: 'var(--space-1)' }}>
                Глобальный переключатель
              </Heading>
              <Text size="sm" color="tertiary">
                Отключить все email и push уведомления одновременно (in-app остаётся активным)
              </Text>
            </div>
            <Toggle
              checked={!globalOff}
              onChange={(v) => handleGlobalToggle(v)}
              label={globalOff ? 'ВЫКЛ' : 'ВКЛ'}
            />
          </div>
        </CardBody>
      </Card>

      {/* Matrix table */}
      <Card>
        <CardBody>
          {/* Header row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 120px',
              gap: 0,
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-elevated)',
            }}
          >
            <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)' }}>
              Категория
            </Mono>
            <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', textAlign: 'center' }}>
              Email
            </Mono>
            <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', textAlign: 'center' }}>
              Push
            </Mono>
          </div>

          {visibleRows.map((row, idx) => {
            const pref = getPref(row.category);
            const emailOn = pref ? pref.channelEmail : true;
            const pushOn = pref ? pref.channelPush : true;
            const isLast = idx === visibleRows.length - 1;

            return (
              <div
                key={row.category}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 120px 120px',
                  gap: 0,
                  padding: 'var(--space-4)',
                  borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
                  background: row.system ? 'var(--color-bg-elevated)' : 'transparent',
                }}
              >
                <div style={{ paddingRight: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                    <Text size="sm" style={{ fontWeight: 600 }}>{row.label}</Text>
                    {row.system && (
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: 'var(--tracking-widest)',
                          textTransform: 'uppercase',
                          color: 'var(--color-text-tertiary)',
                          background: 'var(--color-bg-base)',
                          border: '1px solid var(--color-border-default)',
                          borderRadius: 'var(--radius-xs)',
                          padding: '1px 4px',
                        }}
                      >
                        ВСЕГДА ВКЛ
                      </span>
                    )}
                  </div>
                  <Text size="sm" color="tertiary">{row.description}</Text>
                  {row.system && (
                    <Text size="sm" color="tertiary" style={{ marginTop: 'var(--space-1)', fontStyle: 'italic' }}>
                      Системные уведомления нельзя отключить
                    </Text>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {row.system ? (
                    <Toggle checked={true} disabled label="ВКЛ" />
                  ) : (
                    <Toggle
                      checked={emailOn}
                      onChange={(v) => handleToggle(row.category, 'channelEmail', v)}
                      label={emailOn ? 'ВКЛ' : 'ВЫКЛ'}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {row.system ? (
                    <Toggle checked={true} disabled label="ВКЛ" />
                  ) : pushStatus === 'denied' ? (
                    <div style={{ textAlign: 'center' }}>
                      <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                        ЗАБЛОК.
                      </Mono>
                    </div>
                  ) : (
                    <Toggle
                      checked={pushOn}
                      onChange={(v) => handleToggle(row.category, 'channelPush', v)}
                      label={pushOn ? 'ВКЛ' : 'ВЫКЛ'}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* In-app note */}
      <div
        style={{
          marginTop: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Mono size="xs" style={{ color: 'var(--color-text-tertiary)' }}>
          * In-app уведомления (колокольчик) всегда активны и не могут быть отключены — они гарантируют доступ к важным событиям платформы.
        </Mono>
      </div>
    </DashboardLayout>
  );
}

// ─── Toggle component ──────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}

function Toggle({ checked, onChange, disabled = false, label }: ToggleProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          position: 'relative',
          width: 36,
          height: 20,
          borderRadius: 10,
          background: checked
            ? disabled
              ? 'var(--color-border-default)'
              : 'var(--color-accent-red)'
            : 'var(--color-bg-elevated)',
          border: `1px solid ${checked && !disabled ? 'var(--color-accent-red)' : 'var(--color-border-default)'}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)',
          padding: 0,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: checked && !disabled ? '#fff' : 'var(--color-text-tertiary)',
            transition: 'left var(--duration-fast) var(--ease-default)',
          }}
        />
      </button>
      {label && (
        <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', fontSize: 9, letterSpacing: 'var(--tracking-wider)', textTransform: 'uppercase' }}>
          {label}
        </Mono>
      )}
    </div>
  );
}

// ─── Inline icons ─────────────────────────────────────────────────────────

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
function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h10v12H3z" />
      <path d="M6 2v12M6 5h4M6 8h4M6 11h4" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="10" height="13" rx="1" />
      <path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h12v9H5l-3 3V2z" />
      <path d="M5 6h6M5 9h3" />
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
function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}
