'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getPushPermissionStatus } from '@/lib/push';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreference,
  type NotificationCategory,
} from '@/lib/api';
import { PageHeader } from '@platform/ui/templates';
import { Card, CardBody } from '@platform/ui/molecules';
import { Mono, Text, Heading } from '@platform/ui/atoms';

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
  const { user, accessToken } = useAuth();

  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pushStatus, setPushStatus] = useState<NotificationPermission | 'unsupported'>('default');

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

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const allEmailOff = CATEGORY_ROWS.filter((r) => !r.system).every((r) => {
    const p = getPref(r.category);
    return p ? !p.channelEmail : false;
  });
  const allPushOff = CATEGORY_ROWS.filter((r) => !r.system).every((r) => {
    const p = getPref(r.category);
    return p ? !p.channelPush : false;
  });
  const globalOff = allEmailOff && allPushOff;

  const visibleRows = CATEGORY_ROWS.filter((r) => r.roles.includes(user?.role as 'student' | 'admin'));

  return (
    <>
      <PageHeader
        title="Настройки уведомлений"
        subtitle="Управляйте тем, какие уведомления и по каким каналам вы получаете"
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
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
                padding: 'var(--spacing-2) var(--spacing-4)',
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
            marginBottom: 'var(--spacing-6)',
            padding: 'var(--spacing-4)',
            background: 'var(--color-warning-dim)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            gap: 'var(--spacing-3)',
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div>
            <Mono size="xs" style={{ color: 'var(--color-warning)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', display: 'block', marginBottom: 'var(--spacing-1)' }}>
              Push-уведомления заблокированы браузером
            </Mono>
            <Text size="sm" color="secondary">
              Вы ранее отклонили разрешение на push-уведомления. Чтобы включить их, зайдите в настройки браузера → сайт → Уведомления → «Разрешить».
            </Text>
          </div>
        </div>
      )}

      {/* Global toggle */}
      <Card style={{ marginBottom: 'var(--spacing-6)' }}>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-4)' }}>
            <div>
              <Heading level={3} size="md" style={{ marginBottom: 'var(--spacing-1)' }}>
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
              padding: 'var(--spacing-3) var(--spacing-4)',
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
                  padding: 'var(--spacing-4)',
                  borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
                  background: row.system ? 'var(--color-bg-elevated)' : 'transparent',
                }}
              >
                <div style={{ paddingRight: 'var(--spacing-4)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-1)' }}>
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
                    <Text size="sm" color="tertiary" style={{ marginTop: 'var(--spacing-1)', fontStyle: 'italic' }}>
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
          marginTop: 'var(--spacing-4)',
          padding: 'var(--spacing-3) var(--spacing-4)',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Mono size="xs" style={{ color: 'var(--color-text-tertiary)' }}>
          * In-app уведомления (колокольчик) всегда активны и не могут быть отключены — они гарантируют доступ к важным событиям платформы.
        </Mono>
      </div>
    </>
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--spacing-1)' }}>
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
