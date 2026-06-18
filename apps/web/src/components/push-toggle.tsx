'use client';

/**
 * PushToggle — управление web-push: показывает текущее состояние и кнопку
 * включения. Кнопка вызывает enablePush прямо по клику (user gesture) — это
 * обязательное условие для iOS Safari/PWA.
 */

import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2, Share, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  enablePush,
  getPushPermissionStatus,
  isIOS,
  isPushSupported,
  isStandalonePwa,
} from '@/lib/push';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type View = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'default' | 'granted';

export function PushToggle() {
  const { accessToken } = useAuth();
  const [view, setView] = useState<View>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Определяем окружение только на клиенте (зависит от window/navigator).
    if (!isPushSupported()) {
      // На iOS без standalone PushManager отсутствует — это ожидаемо, а не «не поддерживается».
      if (isIOS() && !isStandalonePwa()) {
        setView('ios-install');
        return;
      }
      setView('unsupported');
      return;
    }
    if (isIOS() && !isStandalonePwa()) {
      setView('ios-install');
      return;
    }
    const status = getPushPermissionStatus();
    if (status === 'denied') setView('denied');
    else if (status === 'granted') setView('granted');
    else setView('default');
  }, []);

  async function handleEnable() {
    if (!accessToken) return;
    setBusy(true);
    try {
      const result = await enablePush(accessToken);
      if (result === 'subscribed') {
        setView('granted');
        toast.success('Push-уведомления включены');
      } else if (result === 'denied') {
        setView('denied');
        toast.error('Вы отклонили разрешение на уведомления');
      } else if (result === 'unsupported') {
        setView('unsupported');
      } else {
        toast.error('Не удалось включить push-уведомления. Попробуйте ещё раз');
      }
    } finally {
      setBusy(false);
    }
  }

  if (view === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Проверка поддержки...
      </div>
    );
  }

  if (view === 'unsupported') {
    return (
      <Alert>
        <BellOff />
        <AlertTitle>Браузер не поддерживает push-уведомления</AlertTitle>
        <AlertDescription>
          Используйте современный браузер (Chrome, Firefox, Safari или Edge), чтобы получать push.
        </AlertDescription>
      </Alert>
    );
  }

  if (view === 'ios-install') {
    return (
      <Alert>
        <Smartphone />
        <AlertTitle>Добавьте приложение на экран «Домой»</AlertTitle>
        <AlertDescription className="flex flex-col gap-1">
          <span>
            На iPhone и iPad push-уведомления работают только из приложения, добавленного на
            домашний экран:
          </span>
          <span className="flex items-center gap-1.5">
            нажмите <Share className="inline size-4" /> «Поделиться» → «На экран «Домой»», затем
            откройте приложение с домашнего экрана и включите уведомления здесь.
          </span>
          <span className="text-xs">Требуется iOS 16.4 или новее.</span>
        </AlertDescription>
      </Alert>
    );
  }

  if (view === 'denied') {
    return (
      <Alert>
        <BellOff />
        <AlertTitle>Push-уведомления заблокированы браузером</AlertTitle>
        <AlertDescription>
          Вы ранее отклонили разрешение. Чтобы включить, зайдите в настройки браузера → этот сайт →
          «Уведомления» → «Разрешить», затем обновите страницу.
        </AlertDescription>
      </Alert>
    );
  }

  if (view === 'granted') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <BellRing className="size-3.5" />
          Push включены
        </Badge>
        <span className="text-sm text-muted-foreground">
          Вы получаете уведомления на этом устройстве.
        </span>
      </div>
    );
  }

  // view === 'default'
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">
        Получайте уведомления на это устройство, даже когда вкладка закрыта.
      </p>
      <Button type="button" onClick={handleEnable} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Bell />}
        {busy ? 'Включаем...' : 'Включить push-уведомления'}
      </Button>
    </div>
  );
}
