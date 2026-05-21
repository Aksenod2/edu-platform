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
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Настройки уведомлений</h1>
          <p className="text-sm text-muted-foreground">Управляйте тем, какие уведомления и по каким каналам вы получаете</p>
        </div>
        <div className="flex items-center gap-3">
          {saveError && (
            <span className="font-mono text-xs text-destructive">{saveError}</span>
          )}
          {saveSuccess && (
            <span className="font-mono text-xs text-muted-foreground">СОХРАНЕНО</span>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {saving ? 'СОХРАНЕНИЕ...' : 'СОХРАНИТЬ'}
          </Button>
        </div>
      </div>

      {/* Web Push status banner */}
      {pushStatus === 'denied' && (
        <Alert className="mb-6 mt-4">
          <AlertDescription className="flex flex-col gap-1">
            <span className="font-mono text-xs font-bold uppercase tracking-wider">
              Push-уведомления заблокированы браузером
            </span>
            <span className="text-sm text-muted-foreground">
              Вы ранее отклонили разрешение на push-уведомления. Чтобы включить их, зайдите в настройки браузера → сайт → Уведомления → «Разрешить».
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Global toggle */}
      <Card className="mb-6 mt-4">
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="mb-1 text-lg font-semibold tracking-tight">
                Глобальный переключатель
              </h3>
              <p className="text-sm text-muted-foreground">
                Отключить все email и push уведомления одновременно (in-app остаётся активным)
              </p>
            </div>
            <Toggle
              checked={!globalOff}
              onChange={(v) => handleGlobalToggle(v)}
              label={globalOff ? 'ВЫКЛ' : 'ВКЛ'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Matrix table */}
      <Card>
        <CardContent className="p-0">
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
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Категория
            </span>
            <span className="text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Email
            </span>
            <span className="text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Push
            </span>
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
                    <p className="text-sm font-semibold text-foreground">{row.label}</p>
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
                  <p className="text-sm text-muted-foreground">{row.description}</p>
                  {row.system && (
                    <p className="mt-1 text-sm italic text-muted-foreground">
                      Системные уведомления нельзя отключить
                    </p>
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
                    <div className="text-center">
                      <span className="font-mono text-xs uppercase text-muted-foreground">
                        ЗАБЛОК.
                      </span>
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
        </CardContent>
      </Card>

      {/* In-app note */}
      <div className="mt-4 rounded-sm border bg-card px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">
          * In-app уведомления (колокольчик) всегда активны и не могут быть отключены — они гарантируют доступ к важным событиям платформы.
        </span>
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
        <span className="font-mono uppercase tracking-wider text-muted-foreground" style={{ fontSize: 9 }}>
          {label}
        </span>
      )}
    </div>
  );
}
