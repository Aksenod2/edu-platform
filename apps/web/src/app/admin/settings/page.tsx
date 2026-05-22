'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@platform/ui/lib/utils';

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
        description="Каналы доставки уведомлений"
        rows={[
          { label: 'Email-уведомления', value: 'Включено' },
          { label: 'Push-уведомления', value: 'Включено (Web Push)' },
          { label: 'Категории', value: 'урок / задание / дедлайн / сообщение', mono: true },
        ]}
        footer={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Настройки уведомлений для пользователей — в карточках учеников
            </span>
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin/students')}>
              Перейти
            </Button>
          </div>
        }
      />

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
