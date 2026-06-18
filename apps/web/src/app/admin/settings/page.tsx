'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronDown, Loader2, Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  getPaymentSettings,
  updatePaymentSettings,
  uploadPaymentQr,
  deletePaymentQr,
  type PaymentSettings,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { PushToggle } from '@/components/push-toggle';
import { InstallAppButton } from '@/components/install-instructions';
import { NotificationSettings } from '@/components/notification-settings';
import { cn } from '@platform/ui/lib/utils';

// Версия приложения из build-арга (см. app-sidebar). В dev — 'dev'.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Заголовок секции в едином стиле страницы настроек.
function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
        {title}
      </h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

function PaymentSettingsSection() {
  const { accessToken } = useAuth();

  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [transferUrl, setTransferUrl] = useState('');
  const [transferPhone, setTransferPhone] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  const [qrBusy, setQrBusy] = useState(false);
  const qrInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await getPaymentSettings(accessToken);
      setSettings(data);
      setTransferUrl(data.transferUrl ?? '');
      setTransferPhone(data.transferPhone ?? '');
      setInstructions(data.instructions ?? '');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки реквизитов');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    try {
      const updated = await updatePaymentSettings(accessToken, {
        transferUrl: transferUrl.trim(),
        transferPhone: transferPhone.trim(),
        instructions: instructions.trim(),
      });
      setSettings(updated);
      toast.success('Реквизиты сохранены');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить реквизиты');
    } finally {
      setSaving(false);
    }
  }

  async function handleQrChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error('Поддерживаются только изображения PNG, JPEG или WebP');
      e.target.value = '';
      return;
    }
    setQrBusy(true);
    try {
      const { qrUrl } = await uploadPaymentQr(accessToken, file);
      setSettings((prev) => (prev ? { ...prev, qrUrl } : { transferUrl: null, transferPhone: null, instructions: null, qrUrl }));
      toast.success('QR-код загружен');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось загрузить QR-код');
    } finally {
      setQrBusy(false);
      if (qrInputRef.current) qrInputRef.current.value = '';
    }
  }

  async function handleQrDelete() {
    if (!accessToken) return;
    setQrBusy(true);
    try {
      await deletePaymentQr(accessToken);
      setSettings((prev) => (prev ? { ...prev, qrUrl: null } : prev));
      toast.success('QR-код удалён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить QR-код');
    } finally {
      setQrBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <SectionHeading
        title="Оплата"
        description="Реквизиты для перевода — студенты видят их на странице «Баланс»"
      />

      {error ? (
        <Card className="border-destructive p-4">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      ) : loading ? (
        <Card className="flex items-center justify-center p-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Реквизиты для перевода</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="transfer-url">Ссылка для перевода</Label>
              <Input
                id="transfer-url"
                type="url"
                value={transferUrl}
                onChange={(e) => setTransferUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="transfer-phone">Телефон для перевода</Label>
              <Input
                id="transfer-phone"
                type="tel"
                value={transferPhone}
                onChange={(e) => setTransferPhone(e.target.value)}
                placeholder="+7 900 000-00-00"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="instructions">Инструкция</Label>
              <Textarea
                id="instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Как и куда переводить, что прислать после оплаты"
                rows={4}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>QR-код</Label>
              {settings?.qrUrl ? (
                <div className="flex flex-wrap items-start gap-4">
                  {/* img, а не next/image: src — подписанный временный URL из S3 */}
                  <img
                    src={settings.qrUrl}
                    alt="QR-код для перевода"
                    className="size-40 rounded-lg border bg-background object-contain p-2"
                  />
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => qrInputRef.current?.click()}
                      disabled={qrBusy}
                    >
                      {qrBusy ? <Loader2 className="animate-spin" /> : <Upload />}
                      Заменить
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleQrDelete}
                      disabled={qrBusy}
                    >
                      <Trash2 />
                      Удалить
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() => qrInputRef.current?.click()}
                  disabled={qrBusy}
                >
                  {qrBusy ? <Loader2 className="animate-spin" /> : <Upload />}
                  Загрузить QR-код
                </Button>
              )}
              <input
                ref={qrInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleQrChange}
                className="hidden"
              />
              <p className="text-xs text-muted-foreground">PNG, JPEG или WebP</p>
            </div>

            <div className="pt-1">
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {saving ? 'Сохранение...' : 'Сохранить реквизиты'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

interface SettingRow {
  label: string;
  value: string;
  mono?: boolean;
  badge?: string;
}

// Свёрнутый блок «О системе» — справочная информация без действий.
function AboutSystemSection() {
  const [open, setOpen] = useState(false);

  const rows: { group: string; items: SettingRow[] }[] = [
    {
      group: 'Платформа',
      items: [
        { label: 'Название', value: 'Обучающая платформа' },
        { label: 'Версия приложения', value: APP_VERSION, mono: true },
        { label: 'Версия API', value: 'v1', mono: true },
        {
          label: 'Окружение',
          value: process.env.NODE_ENV ?? 'production',
          mono: true,
          badge: process.env.NODE_ENV === 'development' ? 'DEV' : undefined,
        },
      ],
    },
    {
      group: 'Аутентификация',
      items: [
        { label: 'Метод', value: 'JWT + Refresh Token' },
        { label: 'Время жизни сессии', value: '15 мин / 30 дней', mono: true },
        { label: 'Хеширование паролей', value: 'bcrypt', mono: true },
        { label: 'Приглашения по email', value: 'Включено' },
      ],
    },
    {
      group: 'Хранилище',
      items: [
        { label: 'Провайдер', value: 'S3-совместимое', mono: true },
        { label: 'Максимальный размер файла', value: '50 MB', mono: true },
        { label: 'Подписанные URL', value: 'Да, TTL 1 час', mono: true },
      ],
    },
  ];

  return (
    <section className="mb-8">
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card className="overflow-hidden p-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div>
                <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
                  О системе
                </span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Справочная информация о платформе
                </p>
              </div>
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t">
              {rows.map((section) => (
                <div key={section.group}>
                  <p className="bg-muted px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.group}
                  </p>
                  {section.items.map((row, idx) => (
                    <div
                      key={row.label}
                      className={cn(
                        'flex items-center justify-between gap-2 px-4 py-3',
                        idx < section.items.length - 1 && 'border-b',
                      )}
                    >
                      <span className="text-sm text-muted-foreground">{row.label}</span>
                      <div className="flex items-center gap-2">
                        {row.badge && <Badge variant="outline">{row.badge}</Badge>}
                        <span
                          className={cn(
                            'text-right text-sm',
                            row.mono
                              ? 'font-mono text-xs text-muted-foreground'
                              : 'text-foreground',
                          )}
                        >
                          {row.value}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </section>
  );
}

export default function AdminSettingsPage() {
  const router = useRouter();

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
          <p className="text-sm text-muted-foreground">Системная конфигурация платформы</p>
        </div>
      </div>

      {/* ── Уведомления (функционально, вверху) ── */}
      <section className="mb-8 mt-4">
        <SectionHeading
          title="Уведомления"
          description="Какие события и по каким каналам приходят вам как администратору"
        />
        <NotificationSettings />
      </section>

      {/* Push на этом устройстве */}
      <section className="mb-8">
        <SectionHeading
          title="Push-уведомления"
          description="Включите push на этом устройстве, чтобы получать оповещения вне платформы"
        />
        <Card>
          <CardContent>
            <PushToggle />
            <div className="mt-3">
              <InstallAppButton />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Telegram-бот */}
      <section className="mb-8">
        <SectionHeading
          title="Telegram-бот"
          description="Дублирование уведомлений преподавателю в чат бота"
        />
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Подключение и настройка бота — в отдельном разделе.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/admin/system/telegram')}
            >
              Настроить Telegram-бота
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* ── Оплата (функционально) ── */}
      <PaymentSettingsSection />

      {/* Указатель на интеграции (Zoom/Telegram/API) — они в разделе «Система» */}
      <section className="mb-8">
        <SectionHeading title="Интеграции" />
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Внешние сервисы (Zoom, Telegram, API-ключи) настраиваются в разделе «Система»
              в боковом меню.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── О системе (справка, свёрнута внизу) ── */}
      <AboutSystemSection />
    </>
  );
}
