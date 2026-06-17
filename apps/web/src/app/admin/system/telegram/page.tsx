'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Send,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  getTelegramIntegration,
  saveTelegramToken,
  linkTelegramChat,
  testTelegram,
  setTelegramEnabled,
  unlinkTelegram,
  ApiError,
  type TelegramIntegrationConfig,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function TelegramIntegrationPage() {
  const { accessToken } = useAuth();

  const [config, setConfig] = useState<TelegramIntegrationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Поле токена бота (секрет — не приходит с сервера, поле всегда пустое).
  const [botToken, setBotToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [savingToken, setSavingToken] = useState(false);
  const [linking, setLinking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  // Локальное состояние тумблера для оптимистичного переключения с откатом.
  const [enabling, setEnabling] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getTelegramIntegration(accessToken);
      setConfig(data);
      setBotToken('');
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Не удалось загрузить настройки Telegram',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) fetchConfig();
  }, [accessToken, fetchConfig]);

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !botToken.trim()) return;
    setSavingToken(true);
    try {
      const data = await saveTelegramToken(accessToken, botToken.trim());
      setConfig(data);
      setBotToken('');
      toast.success('Токен сохранён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить токен');
    } finally {
      setSavingToken(false);
    }
  };

  const handleLink = async () => {
    if (!accessToken) return;
    setLinking(true);
    try {
      const data = await linkTelegramChat(accessToken);
      setConfig(data);
      toast.success('Чат привязан');
    } catch (err) {
      // 409 — преподаватель ещё не написал боту: показываем сообщение от API.
      const message =
        err instanceof ApiError && err.status === 409
          ? err.message || 'Откройте бота, нажмите «Старт» и повторите'
          : err instanceof Error
            ? err.message
            : 'Не удалось привязать чат';
      toast.error(message);
    } finally {
      setLinking(false);
    }
  };

  const handleTest = async () => {
    if (!accessToken) return;
    setTesting(true);
    try {
      const result = await testTelegram(accessToken);
      if (result.ok) {
        toast.success('Тестовое сообщение отправлено');
      } else {
        toast.error('Не удалось отправить тестовое сообщение');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось отправить тест');
    } finally {
      setTesting(false);
    }
  };

  const handleToggleEnabled = async (next: boolean) => {
    if (!accessToken || !config) return;
    // Оптимистично переключаем, при ошибке откатываем.
    const prev = config.enabled;
    setConfig({ ...config, enabled: next });
    setEnabling(true);
    try {
      const data = await setTelegramEnabled(accessToken, next);
      setConfig(data);
    } catch (err) {
      setConfig((c) => (c ? { ...c, enabled: prev } : c));
      toast.error(err instanceof Error ? err.message : 'Не удалось изменить настройку');
    } finally {
      setEnabling(false);
    }
  };

  const handleUnlink = async () => {
    if (!accessToken) return;
    setUnlinking(true);
    try {
      await unlinkTelegram(accessToken);
      toast.success('Интеграция отключена');
      await fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось отключить интеграцию');
    } finally {
      setUnlinking(false);
    }
  };

  const botUrl = config?.botUsername ? `https://t.me/${config.botUsername}` : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Уведомления в Telegram</h1>
        <p className="text-sm text-muted-foreground">
          Получайте уведомления о новых сдачах, сообщениях и зачислениях в личный чат с ботом.
          У каждого преподавателя свой бот.
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
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-4 w-3/4" />
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
          {/* ─── Шаг 1: токен бота ───────────────────────────────── */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Шаг 1. Токен бота</CardTitle>
                {config.tokenSet ? (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="size-3" />
                    Токен сохранён
                  </Badge>
                ) : (
                  <Badge variant="outline">Не настроен</Badge>
                )}
              </div>
              <CardDescription>
                {config.tokenSet && config.botUsername
                  ? `Бот @${config.botUsername}. Чтобы заменить токен, введите новый и сохраните.`
                  : 'Создайте бота в Telegram и вставьте его токен.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {!config.encryptionKeySet && (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>
                    На сервере не настроен ключ шифрования (APP_ENCRYPTION_KEY) — сохранить токен
                    нельзя. Обратитесь к администратору сервера.
                  </AlertDescription>
                </Alert>
              )}

              <Collapsible>
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-left text-sm font-medium hover:bg-muted [&[data-state=open]>svg]:rotate-180">
                  Как создать бота и получить токен
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground marker:text-muted-foreground">
                    <li>
                      Откройте{' '}
                      <a
                        href="https://t.me/BotFather"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
                      >
                        @BotFather
                        <ExternalLink className="size-3.5" />
                      </a>{' '}
                      в Telegram и отправьте команду{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        /newbot
                      </code>{' '}
                      — следуйте шагам (имя и username бота).
                    </li>
                    <li>
                      Скопируйте выданный токен вида{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        123456:ABC-DEF…
                      </code>
                      .
                    </li>
                    <li>Вставьте токен в поле ниже и нажмите «Сохранить токен».</li>
                  </ol>
                </CollapsibleContent>
              </Collapsible>

              <form onSubmit={handleSaveToken} className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="telegram-token">Токен бота</Label>
                  <div className="relative">
                    <Input
                      id="telegram-token"
                      type={showToken ? 'text' : 'password'}
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      placeholder={
                        config.tokenSet ? 'Токен сохранён — введите новый, чтобы заменить' : '123456:ABC-DEF…'
                      }
                      autoComplete="off"
                      disabled={!config.encryptionKeySet}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                      aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                    >
                      {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={savingToken || !botToken.trim() || !config.encryptionKeySet}
                  className="w-full sm:w-auto"
                >
                  {savingToken ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Сохранение…
                    </>
                  ) : (
                    'Сохранить токен'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* ─── Шаг 2: привязка чата ────────────────────────────── */}
          <Card className={config.tokenSet ? undefined : 'opacity-60'}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Шаг 2. Привязка чата</CardTitle>
                {config.connected ? (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="size-3" />
                    Подключено
                  </Badge>
                ) : null}
              </div>
              <CardDescription>
                {config.connected
                  ? 'Бот пишет в ваш личный чат. Можно отправить тест или отключить интеграцию.'
                  : 'Откройте своего бота, нажмите «Старт», затем привяжите чат.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!config.tokenSet ? (
                <p className="text-sm text-muted-foreground">
                  Сначала сохраните токен бота на шаге 1.
                </p>
              ) : config.connected ? (
                <>
                  {config.linkedAt && (
                    <p className="text-sm text-muted-foreground">
                      Чат привязан{' '}
                      <span className="font-medium text-foreground">
                        {new Date(config.linkedAt).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      .
                    </p>
                  )}

                  <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="telegram-enabled" className="cursor-pointer">
                        Уведомления включены
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Доставка уведомлений преподавателю в Telegram.
                      </p>
                    </div>
                    <Switch
                      id="telegram-enabled"
                      checked={config.enabled}
                      disabled={enabling}
                      onCheckedChange={handleToggleEnabled}
                    />
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
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
                          Отправка…
                        </>
                      ) : (
                        <>
                          <Send className="size-4" />
                          Отправить тест
                        </>
                      )}
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={unlinking}
                          className="w-full sm:w-auto"
                        >
                          {unlinking ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              Отключение…
                            </>
                          ) : (
                            'Отключить'
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Отключить интеграцию Telegram?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Токен бота и привязка чата будут удалены. Уведомления в Telegram
                            перестанут приходить. Чтобы вернуть интеграцию, нужно будет ввести
                            токен и привязать чат заново.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={handleUnlink}>Отключить</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              ) : (
                <>
                  <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground marker:text-muted-foreground">
                    <li>
                      Откройте своего бота{' '}
                      {config.botUsername ? (
                        <span className="font-medium">@{config.botUsername}</span>
                      ) : (
                        'в Telegram'
                      )}{' '}
                      и нажмите «Старт».
                    </li>
                    <li>Вернитесь сюда и нажмите «Привязать чат».</li>
                  </ol>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    {botUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => window.open(botUrl, '_blank', 'noopener,noreferrer')}
                        className="w-full sm:w-auto"
                      >
                        <ExternalLink className="size-4" />
                        Открыть @{config.botUsername}
                      </Button>
                    )}
                    <Button
                      type="button"
                      disabled={linking}
                      onClick={handleLink}
                      className="w-full sm:w-auto"
                    >
                      {linking ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Привязка…
                        </>
                      ) : (
                        'Привязать чат'
                      )}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
