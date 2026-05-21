'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-[var(--color-text-tertiary)]">
          {title}
        </h2>
        {description && (
          <p className="mt-1 font-sans text-xs text-[var(--color-text-tertiary)]">{description}</p>
        )}
      </div>
      <div className="border border-[var(--color-border-default)]">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className={cn(
              'flex items-center justify-between px-4 py-3',
              idx < rows.length - 1 && 'border-b border-[var(--color-border-subtle)]',
            )}
          >
            <span className="font-sans text-sm text-[var(--color-text-secondary)]">{row.label}</span>
            <div className="flex items-center gap-2">
              {row.badge && <Badge variant="outline">{row.badge}</Badge>}
              <span
                className={cn(
                  'text-sm',
                  row.mono ? 'font-mono text-xs text-[var(--color-text-tertiary)]' : 'font-sans text-[var(--color-text-primary)]',
                )}
              >
                {row.value}
              </span>
            </div>
          </div>
        ))}
        {footer && (
          <div className="px-4 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            {footer}
          </div>
        )}
      </div>
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
          { label: 'Категории', value: 'урок / задание / дедлайн / тред', mono: true },
        ]}
        footer={
          <div className="flex items-center gap-3">
            <span className="font-sans text-xs text-[var(--color-text-tertiary)]">
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
            <span className="font-sans text-xs text-[var(--color-text-tertiary)]">
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
          <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-[var(--color-error)]">
            Опасная зона
          </h2>
        </div>
        <div className="border border-[var(--color-error)] bg-[var(--color-error-dim)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-sans text-sm font-semibold text-[var(--color-text-primary)] mb-1">
                Сбросить данные платформы
              </p>
              <p className="font-sans text-xs text-[var(--color-text-tertiary)]">
                Необратимое удаление всех данных. Доступно только через прямой доступ к БД.
              </p>
            </div>
            <Badge variant="destructive">Только для суперадмина</Badge>
          </div>
        </div>
      </section>
    </>
  );
}
