'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  getZoomIntegration,
  updateZoomIntegration,
  testZoomIntegration,
  type ZoomIntegrationConfig,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

const MARKETPLACE_URL = 'https://marketplace.zoom.us';

export default function ZoomIntegrationPage() {
  const { accessToken } = useAuth();

  const [config, setConfig] = useState<ZoomIntegrationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Поля формы
  const [accountId, setAccountId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [autoCreateMeeting, setAutoCreateMeeting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Применить ответ сервера к локальному состоянию формы.
  const applyConfig = useCallback((data: ZoomIntegrationConfig) => {
    setConfig(data);
    setAccountId(data.accountId ?? '');
    setClientId(data.clientId ?? '');
    setEnabled(data.enabled);
    setAutoCreateMeeting(data.autoCreateMeeting);
    // Секрет никогда не приходит с сервера — поле всегда пустое после загрузки.
    setClientSecret('');
  }, []);

  const fetchConfig = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getZoomIntegration(accessToken);
      applyConfig(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить настройки Zoom');
    } finally {
      setLoading(false);
    }
  }, [accessToken, applyConfig]);

  useEffect(() => {
    if (accessToken) fetchConfig();
  }, [accessToken, fetchConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    try {
      const payload: Parameters<typeof updateZoomIntegration>[1] = {
        enabled,
        autoCreateMeeting,
        accountId: accountId.trim(),
        clientId: clientId.trim(),
      };
      // clientSecret отправляем только если поле непустое — иначе секрет не меняем.
      if (clientSecret.trim()) {
        payload.clientSecret = clientSecret.trim();
      }
      const data = await updateZoomIntegration(accessToken, payload);
      applyConfig(data);
      toast.success('Настройки сохранены');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!accessToken) return;
    setTesting(true);
    try {
      const result = await testZoomIntegration(accessToken);
      if (result.ok) {
        toast.success(result.message || 'Подключение работает');
      } else {
        toast.error(result.message || 'Подключение не удалось');
      }
      // Обновляем конфиг, чтобы подтянуть lastTestedAt / lastTestOk и статус-бейдж.
      await fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось проверить подключение');
    } finally {
      setTesting(false);
    }
  };

  // ─── Бейдж статуса последней проверки ───────────────────────────
  function renderTestBadge() {
    if (!config) return null;
    if (config.lastTestOk === null || !config.lastTestedAt) {
      return <Badge variant="outline">Не проверялось</Badge>;
    }
    const when = new Date(config.lastTestedAt).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return config.lastTestOk ? (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="size-3" />
        Проверено · {when}
      </Badge>
    ) : (
      <Badge variant="destructive">Ошибка · {when}</Badge>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Интеграция Zoom</h1>
        <p className="text-sm text-muted-foreground">
          Подключение по Server-to-Server OAuth для автоматического создания ссылок на занятия.
          У каждого преподавателя свой ключ Zoom.
        </p>
      </div>

      {/* ─── Состояние загрузки ──────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription className="flex flex-col items-start gap-2">
            {loadError}
            <Button variant="outline" size="sm" onClick={fetchConfig}>
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      ) : config ? (
        <div className="flex flex-col gap-6">
          {/* ─── Как подключить ──────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Как подключить</CardTitle>
              <CardDescription>
                Создайте приложение Server-to-Server OAuth в Zoom App Marketplace и перенесите
                учётные данные сюда.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-foreground marker:text-muted-foreground">
                <li>
                  Откройте{' '}
                  <a
                    href={MARKETPLACE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
                  >
                    marketplace.zoom.us
                    <ExternalLink className="size-3.5" />
                  </a>{' '}
                  → <span className="font-medium">Develop</span> →{' '}
                  <span className="font-medium">Build App</span> → выберите тип{' '}
                  <span className="font-medium">Server-to-Server OAuth</span> (нужен аккаунт Zoom
                  Pro).
                </li>
                <li>
                  Скопируйте <span className="font-medium">Account ID</span>,{' '}
                  <span className="font-medium">Client ID</span> и{' '}
                  <span className="font-medium">Client Secret</span> со вкладки{' '}
                  <span className="font-medium">App Credentials</span>.
                </li>
                <li>
                  На вкладке <span className="font-medium">Scopes</span> добавьте два права:{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    meeting:write:meeting:admin
                  </code>{' '}
                  (создание встреч) и{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    user:read:user:admin
                  </code>{' '}
                  (проверка подключения). Если в приложении старый формат scope&apos;ов —
                  используйте эквиваленты{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    meeting:write:admin
                  </code>{' '}
                  и{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    user:read:admin
                  </code>
                  .
                </li>
                <li>
                  Нажмите <span className="font-medium">Activate</span>, чтобы активировать
                  приложение.
                </li>
                <li>
                  Вставьте значения в форму ниже, нажмите{' '}
                  <span className="font-medium">«Сохранить»</span>, затем{' '}
                  <span className="font-medium">«Проверить подключение»</span>.
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* ─── Настройки ───────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Настройки</CardTitle>
                {renderTestBadge()}
              </div>
              <CardDescription>
                Учётные данные приложения Zoom и параметры интеграции.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!config.encryptionKeySet && (
                <Alert variant="destructive" className="mb-6">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>
                    На сервере не настроен ключ шифрования (APP_ENCRYPTION_KEY) — сохранить секрет
                    нельзя. Обратитесь к администратору сервера.
                  </AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSave} className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="zoom-account-id">Account ID</Label>
                  <Input
                    id="zoom-account-id"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    placeholder="Account ID из App Credentials"
                    autoComplete="off"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="zoom-client-id">Client ID</Label>
                  <Input
                    id="zoom-client-id"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Client ID из App Credentials"
                    autoComplete="off"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="zoom-client-secret">Client Secret</Label>
                  <div className="relative">
                    <Input
                      id="zoom-client-secret"
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={
                        config.secretSet
                          ? `••••${config.secretLast4 ?? ''}`
                          : 'Введите Client Secret'
                      }
                      autoComplete="off"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                      aria-label={showSecret ? 'Скрыть секрет' : 'Показать секрет'}
                    >
                      {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {config.secretSet
                      ? 'Секрет сохранён. Оставьте поле пустым, чтобы не менять его.'
                      : 'Пустое поле — секрет не будет сохранён.'}
                  </p>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="zoom-auto-create" className="cursor-pointer">
                      Создавать ссылку Zoom при планировании занятия
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Для новых занятий автоматически создаётся встреча Zoom.
                    </p>
                  </div>
                  <Switch
                    id="zoom-auto-create"
                    checked={autoCreateMeeting}
                    onCheckedChange={setAutoCreateMeeting}
                  />
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="zoom-enabled" className="cursor-pointer">
                      Интеграция включена
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Полностью включает или отключает интеграцию с Zoom.
                    </p>
                  </div>
                  <Switch id="zoom-enabled" checked={enabled} onCheckedChange={setEnabled} />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                    {saving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Сохранение…
                      </>
                    ) : (
                      'Сохранить'
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testing}
                    onClick={handleTest}
                    className="w-full sm:w-auto"
                  >
                    {testing ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Проверка…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-4" />
                        Проверить подключение
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
