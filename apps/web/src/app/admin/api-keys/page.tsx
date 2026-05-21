'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
} from '@/lib/api';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Button, Spinner, Badge } from '@platform/ui/atoms';
import { cn } from '@platform/ui/lib/utils';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',       href: '/admin',               icon: <GridIcon /> },
      { label: 'Ученики',     href: '/admin/students',      icon: <UsersIcon /> },
      { label: 'Потоки',      href: '/admin/streams',       icon: <StreamIcon /> },
      { label: 'Расписание',  href: '/admin/schedule',      icon: <CalendarIcon /> },
    ],
  },
  {
    label: 'Контент',
    items: [
      { label: 'Материалы',   href: '/admin/materials',     icon: <FolderIcon /> },
    ],
  },
  {
    label: 'Система',
    items: [
      { label: 'Уведомления', href: '/admin/notifications', icon: <BellNavIcon /> },
      { label: 'API-ключи',   href: '/admin/api-keys',      icon: <KeyIcon /> },
      { label: 'Настройки',   href: '/admin/settings',      icon: <SettingsIcon /> },
    ],
  },
];

export default function ApiKeysPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [error, setError] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setBaseUrl(window.location.origin);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchKeys = useCallback(async () => {
    if (!accessToken) return;
    setLoadingKeys(true);
    try {
      const data = await getApiKeys(accessToken);
      setApiKeys(data.apiKeys);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки ключей');
    } finally {
      setLoadingKeys(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) fetchKeys();
  }, [accessToken, fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !newKeyName.trim()) return;
    setCreating(true);
    try {
      const data = await createApiKey(accessToken, newKeyName.trim());
      setNewKeyValue(data.apiKey.key);
      setNewKeyName('');
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания ключа');
      setShowCreateModal(false);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    if (!accessToken) return;
    if (!confirm(`Отозвать ключ «${key.name}»? Это действие необратимо.`)) return;
    setRevoking(key.id);
    try {
      await revokeApiKey(accessToken, key.id);
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отзыва ключа');
    } finally {
      setRevoking(null);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const closeNewKey = () => {
    setNewKeyValue(null);
    setShowCreateModal(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  const proxyBase = baseUrl ? `${baseUrl}/api-proxy` : '/api-proxy';

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => { await logout(); router.push('/login'); },
        notificationBell: <NotificationBell />,
        platformName: 'PLATFORM ADMIN',
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
      <PageHeader
        title="API-ключи"
        subtitle="Управление ключами для внешних интеграций"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setShowCreateModal(true); setNewKeyValue(null); }}
          >
            + Создать ключ
          </Button>
        }
      />

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 border border-[var(--color-error)] bg-[var(--color-error-dim)] font-mono text-xs text-[var(--color-error)]">
          {error}
        </div>
      )}

      {/* Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] p-6">
            {newKeyValue ? (
              <>
                <h3 className="font-mono text-sm font-bold tracking-widest uppercase text-[var(--color-text-primary)] mb-4">
                  API-ключ создан
                </h3>
                <div className="mb-4 px-3 py-3 bg-[var(--color-warning-dim)] border border-[var(--color-warning)] font-sans text-xs text-[var(--color-warning)]">
                  Скопируйте ключ сейчас. После закрытия окна он больше не будет показан.
                </div>
                <div className="flex items-center gap-2 mb-4 px-3 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]">
                  <code className="flex-1 font-mono text-xs text-[var(--color-text-primary)] break-all">
                    {newKeyValue}
                  </code>
                  <Button
                    variant={copied ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleCopy(newKeyValue)}
                    className="shrink-0"
                  >
                    {copied ? '✓' : 'Копировать'}
                  </Button>
                </div>
                <Button variant="primary" size="sm" onClick={closeNewKey}>
                  Закрыть
                </Button>
              </>
            ) : (
              <>
                <h3 className="font-mono text-sm font-bold tracking-widest uppercase text-[var(--color-text-primary)] mb-4">
                  Новый API-ключ
                </h3>
                <form onSubmit={handleCreate}>
                  <div className="mb-4">
                    <label
                      htmlFor="key-name"
                      className="block mb-1 font-mono text-xs uppercase tracking-widest text-[var(--color-text-tertiary)]"
                    >
                      Название ключа
                    </label>
                    <input
                      id="key-name"
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="Например: Интеграция с CRM"
                      required
                      autoFocus
                      className={cn(
                        'w-full px-3 py-2',
                        'font-sans text-sm',
                        'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]',
                        'border border-[var(--color-border-default)]',
                        'focus:outline-none focus:border-[var(--color-accent-red)]',
                      )}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" size="sm" loading={creating}>
                      Создать
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowCreateModal(false); setNewKeyName(''); }}
                    >
                      Отмена
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Keys table */}
      <section className="mb-8">
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-[var(--color-text-tertiary)] mb-4">
          Активные ключи
        </h2>

        {loadingKeys ? (
          <div className="flex justify-center py-12">
            <Spinner size="md" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 border border-[var(--color-border-subtle)] gap-3">
            <span className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">
              Нет активных API-ключей
            </span>
            <span className="font-sans text-xs text-[var(--color-text-tertiary)]">
              Создайте первый ключ с помощью кнопки выше
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-strong)]">
                  {['Название', 'Префикс ключа', 'Создан', 'Последнее использование', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left font-mono text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-elevated)] transition-colors">
                    <td className="px-4 py-3 text-[var(--color-text-primary)] font-sans text-sm">
                      {key.name}
                    </td>
                    <td className="px-4 py-3">
                      <code className="font-mono text-xs text-[var(--color-text-secondary)]">
                        {key.keyPrefix}...
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
                        {new Date(key.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {key.lastUsedAt ? (
                        <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
                          {new Date(key.lastUsedAt).toLocaleDateString('ru-RU')}
                        </span>
                      ) : (
                        <Badge variant="default">Не использовался</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="danger"
                        size="sm"
                        loading={revoking === key.id}
                        onClick={() => handleRevoke(key)}
                      >
                        Отозвать
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Connection guide */}
      <section className="mb-8">
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-[var(--color-text-tertiary)] mb-4">
          Подключение к API
        </h2>
        <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">
          <div className="mb-4">
            <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
              Base URL
            </p>
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)]">
              <code className="font-mono text-xs text-[var(--color-text-primary)] flex-1">{proxyBase}</code>
            </div>
          </div>

          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
              Аутентификация
            </p>
            <p className="font-sans text-sm text-[var(--color-text-secondary)] mb-2">
              Добавьте заголовок <code className="font-mono text-xs bg-[var(--color-bg-elevated)] px-1">Authorization</code> к каждому запросу:
            </p>
            <div className="px-3 py-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)]">
              <code className="font-mono text-xs text-[var(--color-text-primary)] whitespace-pre">
                {`Authorization: Bearer ваш_api_ключ`}
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* API examples */}
      <section className="mb-8">
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-[var(--color-text-tertiary)] mb-4">
          Примеры запросов
        </h2>
        <div className="flex flex-col gap-3">
          {[
            { title: 'Список учеников',       code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/users` },
            { title: 'Задания ученика',        code: `curl -H 'Authorization: Bearer sk_...' \\\n  '${proxyBase}/student-assignments?studentId=ID'` },
            { title: 'Список потоков',         code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/streams` },
            { title: 'Профиль ученика',        code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/profiles/ID` },
            { title: 'Лента ученика',          code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/threads/ID` },
          ].map(({ title, code }) => (
            <div key={title} className="border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
              <div className="px-4 py-2 border-b border-[var(--color-border-subtle)]">
                <span className="font-mono text-xs font-bold tracking-wider uppercase text-[var(--color-text-secondary)]">
                  {title}
                </span>
              </div>
              <div className="px-4 py-3 overflow-x-auto">
                <code className="font-mono text-xs text-[var(--color-text-primary)] whitespace-pre">
                  {code}
                </code>
              </div>
            </div>
          ))}
        </div>
      </section>
    </DashboardLayout>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" /><path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" /><path d="M15 13c0-2-1-4-3-4" />
    </svg>
  );
}
function StreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h10" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" /><path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4a1 1 0 011-1h4l2 2h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" />
    </svg>
  );
}
function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" /><path d="M8 2.5V1" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3.5" />
      <path d="M8.5 8.5l5.5 5.5M11 11l1.5 1.5" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}
