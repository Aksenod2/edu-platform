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
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PushToggle } from '@/components/push-toggle';

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
    description: 'Новые уроки и задания в группе',
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
    description: 'Ответы в сообщениях, проверка заданий',
    roles: ['student', 'admin'],
    system: false,
  },
  {
    category: 'schedule',
    label: 'Расписание',
    description: 'Новые события в расписании группы',
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
    },
    [user],
  );

  const handleSave = useCallback(async () => {
    if (!accessToken) return;
    setSaving(true);
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
      toast.success('Настройки сохранены');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [accessToken, prefs]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
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
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>

      {/* Web Push: статус + кнопка включения (важно для iOS — подписка по жесту) */}
      <Card className="mb-6 mt-4">
        <CardContent>
          <div className="mb-3">
            <h3 className="text-lg font-semibold tracking-tight">Push на этом устройстве</h3>
            <p className="text-sm text-muted-foreground">
              Уведомления приходят, даже когда платформа закрыта
            </p>
          </div>
          <PushToggle />
        </CardContent>
      </Card>

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
          <div className="grid grid-cols-[1fr_120px_120px] border-b bg-muted px-4 py-3">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Категория
            </span>
            <span className="text-center text-xs uppercase tracking-widest text-muted-foreground">
              Email
            </span>
            <span className="text-center text-xs uppercase tracking-widest text-muted-foreground">
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
                className={`grid grid-cols-[1fr_120px_120px] p-4 ${isLast ? '' : 'border-b'} ${row.system ? 'bg-muted' : ''}`}
              >
                <div className="pr-4">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{row.label}</p>
                    {row.system && <Badge variant="outline">Всегда вкл</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{row.description}</p>
                  {row.system && (
                    <p className="mt-1 text-sm italic text-muted-foreground">
                      Системные уведомления нельзя отключить
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-center">
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

                <div className="flex items-center justify-center">
                  {row.system ? (
                    <Toggle checked={true} disabled label="ВКЛ" />
                  ) : pushStatus === 'denied' ? (
                    <div className="text-center">
                      <span className="text-xs uppercase text-muted-foreground">
                        Заблок.
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
      <div className="mt-4 rounded-md border bg-card px-4 py-3">
        <span className="text-xs text-muted-foreground">
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
  const on = checked && !disabled;
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        className={[
          'relative h-5 w-9 rounded-full border p-0 transition-colors',
          on
            ? 'border-primary bg-primary'
            : checked
              ? 'border-input bg-input'
              : 'border-input bg-muted',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 size-3.5 rounded-full transition-all',
            checked ? 'left-4' : 'left-0.5',
            on ? 'bg-primary-foreground' : 'bg-muted-foreground',
          ].join(' ')}
        />
      </button>
      {label && (
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      )}
    </div>
  );
}
