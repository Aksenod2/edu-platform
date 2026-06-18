'use client';

import { Card, CardContent } from '@/components/ui/card';
import { PushToggle } from '@/components/push-toggle';
import { InstallAppButton } from '@/components/install-instructions';
import { NotificationSettings } from '@/components/notification-settings';

export default function NotificationSettingsPage() {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Настройки уведомлений</h1>
          <p className="text-sm text-muted-foreground">
            Управляйте тем, какие уведомления и по каким каналам вы получаете
          </p>
        </div>
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
          <div className="mt-3">
            <InstallAppButton />
          </div>
        </CardContent>
      </Card>

      {/* Матрица категорий × Email/Push (общий компонент) */}
      <NotificationSettings />
    </>
  );
}
