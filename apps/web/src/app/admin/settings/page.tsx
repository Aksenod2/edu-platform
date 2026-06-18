'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload, Trash2 } from 'lucide-react';
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
import { PushToggle } from '@/components/push-toggle';
import { InstallAppButton } from '@/components/install-instructions';
import { cn } from '@platform/ui/lib/utils';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

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
      <div className="mb-4">
        <h2 className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
          Оплата
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Реквизиты для перевода — студенты видят их на странице «Баланс»
        </p>
      </div>

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

function SettingsSection({
  title,
  description,
  rows,
  footer,
}: {
  title: string;
  description?: string;
  rows: SettingRow[];
  footer?: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Card className="overflow-hidden p-0">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className={cn(
              'flex items-center justify-between px-4 py-3',
              idx < rows.length - 1 && 'border-b',
            )}
          >
            <span className="text-sm text-muted-foreground">{row.label}</span>
            <div className="flex items-center gap-2">
              {row.badge && <Badge variant="outline">{row.badge}</Badge>}
              <span
                className={cn(
                  'text-sm',
                  row.mono ? 'font-mono text-xs text-muted-foreground' : 'text-foreground',
                )}
              >
                {row.value}
              </span>
            </div>
          </div>
        ))}
        {footer && (
          <div className="px-4 py-3 border-t bg-muted">
            {footer}
          </div>
        )}
      </Card>
    </section>
  );
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const [buildTime] = useState(() => new Date().toISOString());

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
          <p className="text-sm text-muted-foreground">Системная конфигурация платформы</p>
        </div>
      </div>

      <SettingsSection
        title="Платформа"
        rows={[
          { label: 'Название', value: 'Обучающая платформа' },
          { label: 'Версия API', value: 'v1', mono: true },
          { label: 'Окружение', value: process.env.NODE_ENV ?? 'production', mono: true, badge: process.env.NODE_ENV === 'development' ? 'DEV' : undefined },
          { label: 'Последнее обновление страницы', value: buildTime, mono: true },
        ]}
      />

      <SettingsSection
        title="Аутентификация"
        description="Параметры сессий и безопасности"
        rows={[
          { label: 'Метод аутентификации', value: 'JWT + Refresh Token' },
          { label: 'Время жизни сессии', value: '15 мин (access) / 30 дней (refresh)', mono: true },
          { label: 'Хеширование паролей', value: 'bcrypt', mono: true },
          { label: 'Приглашения по email', value: 'Включено' },
        ]}
      />

      <SettingsSection
        title="Уведомления"
        description="Категории уведомлений и персональные настройки"
        rows={[
          { label: 'Категории', value: 'урок / задание / дедлайн / сообщение', mono: true },
        ]}
        footer={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Настройки уведомлений для пользователей — в карточках студентов
            </span>
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin/students')}>
              Перейти
            </Button>
          </div>
        }
      />

      <section className="mb-8">
        <div className="mb-4">
          <h2 className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
            Push-уведомления
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Включите push на этом устройстве, чтобы получать оповещения вне платформы
          </p>
        </div>
        <Card>
          <CardContent>
            <PushToggle />
            <div className="mt-3">
              <InstallAppButton />
            </div>
          </CardContent>
        </Card>
      </section>

      <SettingsSection
        title="Хранилище"
        description="S3-совместимое хранилище файлов (MinIO)"
        rows={[
          { label: 'Провайдер', value: 'MinIO (S3-compatible)', mono: true },
          { label: 'Загрузка файлов', value: 'Включено' },
          { label: 'Максимальный размер файла', value: '50 MB', mono: true },
          { label: 'Подписанные URL', value: 'Да, TTL 1 час', mono: true },
        ]}
      />

      <SettingsSection
        title="API-интеграция"
        description="Внешний доступ через API-ключи"
        rows={[
          { label: 'API-прокси', value: '/api-proxy', mono: true },
          { label: 'Аутентификация', value: 'Bearer token (API-ключ)' },
          { label: 'Управление ключами', value: 'В разделе API-ключи' },
        ]}
        footer={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Создать и управлять API-ключами
            </span>
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin/api-keys')}>
              Перейти
            </Button>
          </div>
        }
      />

      <SettingsSection
        title="Интеграции"
        description="Внешние сервисы преподавателя — у каждого свои ключи"
        rows={[
          { label: 'Zoom', value: 'Создание ссылок на занятия, записи и итоги' },
          { label: 'Telegram', value: 'Уведомления преподавателю в чат бота' },
        ]}
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Настроить интеграции
            </span>
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin/system/zoom')}>
              Zoom
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin/system/telegram')}>
              Telegram
            </Button>
          </div>
        }
      />

      <PaymentSettingsSection />

      {/* Danger zone */}
      <section className="mb-8">
        <div className="mb-4">
          <h2 className="text-xs font-bold tracking-widest uppercase text-destructive">
            Опасная зона
          </h2>
        </div>
        <Card className="border-destructive p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">
                Сбросить данные платформы
              </p>
              <p className="text-xs text-muted-foreground">
                Необратимое удаление всех данных. Доступно только через прямой доступ к БД.
              </p>
            </div>
            <Badge variant="destructive">Только для суперадмина</Badge>
          </div>
        </Card>
      </section>
    </>
  );
}
