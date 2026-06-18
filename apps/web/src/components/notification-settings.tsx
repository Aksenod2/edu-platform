'use client';

/**
 * NotificationSettings — переиспользуемая матрица уведомлений (категория × Email/Push).
 *
 * Один компонент для студенческой страницы `/dashboard/settings/notifications`
 * и встройки в `/admin/settings`. Видимые категории фильтруются по `user.role`,
 * логика загрузки/сохранения preferences — через api. Переключатели — shadcn
 * `Switch` (без кастомных обёрток).
 *
 * Адаптив: на десктопе — таблица-матрица (категория + колонки Email/Push); на
 * узких экранах (<sm, ~360px) колонки не влезают, поэтому каждая категория
 * рендерится отдельной карточкой со строками-переключателями (тап-таргет ≥44px).
 */

import { useEffect, useState, useCallback } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { getPushPermissionStatus } from '@/lib/push';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  getEventReminderPreferences,
  updateEventReminderPreferences,
  type NotificationPreference,
  type NotificationCategory,
  type EventReminderPreferences,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@platform/ui/lib/utils';

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

export interface NotificationSettingsProps {
  /**
   * Внешняя кнопка «Сохранить» (например, в шапке отдельной страницы). Когда
   * передан renderSaveSlot — он получит готовый элемент кнопки. Иначе компонент
   * рисует собственную кнопку сохранения внизу.
   */
  renderSaveSlot?: (saveButton: React.ReactNode) => React.ReactNode;
}

export function NotificationSettings({ renderSaveSlot }: NotificationSettingsProps = {}) {
  const { user, accessToken } = useAuth();

  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [reminders, setReminders] = useState<EventReminderPreferences>({
    remind60: true,
    remind15: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushStatus, setPushStatus] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setPushStatus(getPushPermissionStatus());
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    Promise.all([
      getNotificationPreferences(accessToken).then((data) => setPrefs(data.preferences)),
      getEventReminderPreferences(accessToken).then((data) => setReminders(data)),
    ])
      .catch(() => {
        // Дефолты остаются: пустая матрица + оба напоминания ВКЛ.
        setPrefs([]);
      })
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
      const [data, savedReminders] = await Promise.all([
        updateNotificationPreferences(accessToken, updates),
        updateEventReminderPreferences(accessToken, reminders),
      ]);
      setPrefs(data.preferences);
      setReminders(savedReminders);
      toast.success('Настройки сохранены');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [accessToken, prefs, reminders]);

  const saveButton = (
    <Button onClick={handleSave} disabled={saving || loading}>
      {saving && <Loader2 className="animate-spin" />}
      {saving ? 'Сохранение...' : 'Сохранить'}
    </Button>
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const visibleRows = CATEGORY_ROWS.filter((r) =>
    r.roles.includes(user?.role as 'student' | 'admin'),
  );

  // Глобальный рубильник: выключен, когда у всех несистемных категорий оба
  // канала отключены.
  const toggleableRows = visibleRows.filter((r) => !r.system);
  const globalOn = toggleableRows.some((r) => {
    const p = getPref(r.category);
    return p ? p.channelEmail || p.channelPush : true;
  });

  // Один переключатель канала для строки — учитывает системные (всегда вкл) и
  // заблокированный браузером push. Высота h-11 (44px) для удобного тапа.
  function ChannelSwitch({
    row,
    channel,
  }: {
    row: CategoryRow;
    channel: 'channelEmail' | 'channelPush';
  }) {
    if (row.system) {
      return <Switch checked disabled aria-label="Всегда включено" />;
    }
    if (channel === 'channelPush' && pushStatus === 'denied') {
      return (
        <span className="text-xs uppercase text-muted-foreground">Заблок.</span>
      );
    }
    const pref = getPref(row.category);
    const on = pref ? pref[channel] : true;
    return (
      <Switch
        checked={on}
        onCheckedChange={(v) => handleToggle(row.category, channel, v)}
        aria-label={`${row.label}: ${channel === 'channelEmail' ? 'Email' : 'Push'}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Глобальный рубильник: отключить все email и push разом */}
      {toggleableRows.length > 0 && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Все уведомления
              </p>
              <p className="text-sm text-muted-foreground">
                Отключить email и push разом (in-app колокольчик остаётся)
              </p>
            </div>
            <Switch
              checked={globalOn}
              onCheckedChange={handleGlobalToggle}
              aria-label="Все уведомления"
            />
          </CardContent>
        </Card>
      )}

      {/* Десктоп: таблица-матрица */}
      <Card className="hidden sm:block">
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_88px_88px] border-b bg-muted px-4 py-3">
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
            const isLast = idx === visibleRows.length - 1;
            return (
              <div
                key={row.category}
                className={cn(
                  'grid grid-cols-[1fr_88px_88px] items-center px-4 py-4',
                  !isLast && 'border-b',
                  row.system && 'bg-muted/50',
                )}
              >
                <div className="pr-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{row.label}</p>
                    {row.system && <Badge variant="outline">Всегда вкл</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{row.description}</p>
                </div>
                <div className="flex items-center justify-center">
                  <ChannelSwitch row={row} channel="channelEmail" />
                </div>
                <div className="flex items-center justify-center">
                  <ChannelSwitch row={row} channel="channelPush" />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Мобилка (~360px): каждая категория — карточка со строками каналов */}
      <div className="flex flex-col gap-3 sm:hidden">
        {visibleRows.map((row) => (
          <Card key={row.category} className={cn(row.system && 'bg-muted/50')}>
            <CardContent className="p-4">
              <div className="mb-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{row.label}</p>
                  {row.system && <Badge variant="outline">Всегда вкл</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{row.description}</p>
              </div>
              <div className="-my-1 flex flex-col">
                <label className="flex h-11 items-center justify-between">
                  <span className="text-sm text-foreground">Email</span>
                  <ChannelSwitch row={row} channel="channelEmail" />
                </label>
                <label className="flex h-11 items-center justify-between">
                  <span className="text-sm text-foreground">Push</span>
                  <ChannelSwitch row={row} channel="channelPush" />
                </label>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Напоминания о занятиях и встречах — отдельный блок (только push-канал) */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Напоминания о занятиях и встречах
              </p>
              <p className="text-sm text-muted-foreground">
                Заранее напомним о начале занятия или встречи push-уведомлением на это
                устройство.
              </p>
            </div>
          </div>

          {pushStatus !== 'granted' && (
            <Alert>
              <AlertTitle>Push на этом устройстве не включён</AlertTitle>
              <AlertDescription>
                Без push-уведомлений напоминания не придут. Включите push в блоке «Push на
                этом устройстве». Сами тумблеры можно настроить здесь — настройка
                переносится между устройствами.
              </AlertDescription>
            </Alert>
          )}

          <div className="-my-1 flex flex-col">
            <label className="flex h-11 items-center justify-between gap-4">
              <span className="text-sm text-foreground">За 1 час до начала</span>
              <Switch
                checked={reminders.remind60}
                onCheckedChange={(v) => setReminders((r) => ({ ...r, remind60: v }))}
                aria-label="Напоминание за 1 час до начала"
              />
            </label>
            <label className="flex h-11 items-center justify-between gap-4">
              <span className="text-sm text-foreground">За 15 минут до начала</span>
              <Switch
                checked={reminders.remind15}
                onCheckedChange={(v) => setReminders((r) => ({ ...r, remind15: v }))}
                aria-label="Напоминание за 15 минут до начала"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* In-app note */}
      <div className="rounded-md border bg-card px-4 py-3">
        <span className="text-xs text-muted-foreground">
          * In-app уведомления (колокольчик) всегда активны и не могут быть отключены — они
          гарантируют доступ к важным событиям платформы.
        </span>
      </div>

      {/* Кнопка сохранения: либо отдаём наружу (в шапку), либо рисуем сами */}
      {renderSaveSlot ? renderSaveSlot(saveButton) : <div>{saveButton}</div>}
    </div>
  );
}
