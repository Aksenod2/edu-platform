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
import { Card, CardHeader, CardBody } from '@platform/ui/molecules';
import { Button, Heading, Text, Mono, Spinner, Badge } from '@platform/ui/atoms';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',       href: '/admin',               icon: <GridIcon /> },
      { label: 'Ученики',     href: '/admin/students',      icon: <UsersIcon /> },
      { label: 'Потоки',      href: '/admin/streams',       icon: <StreamIcon /> },
      { label: 'Расписание',  href: '/admin/schedule',      icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/admin/notifications', icon: <BellNavIcon /> },
      { label: 'API-доступ',  href: '/admin/api-access',    icon: <KeyIcon /> },
    ],
  },
];

export default function ApiAccessPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [error, setError] = useState('');

  // Создание ключа
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  // Отзыв ключа
  const [revoking, setRevoking] = useState<string | null>(null);

  // Копирование
  const [copied, setCopied] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBaseUrl(window.location.origin);
    }
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
      // fallback — select the text
    }
  };

  const closeNewKey = () => {
    setNewKeyValue(null);
    setShowCreateModal(false);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
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
        title="API-доступ"
        subtitle="Управление API-ключами и документация по интеграции"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setShowCreateModal(true); setNewKeyValue(null); }}
          >
            Создать API-ключ
          </Button>
        }
      />

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>
          <Text size="sm" style={{ color: 'var(--color-error)' }}>{error}</Text>
        </Card>
      )}

      {/* ─── Модальное окно создания ключа ───────────────────────── */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 'var(--space-4)',
        }}>
          <Card variant="elevated" padding="lg" style={{ width: '100%', maxWidth: 480 }}>
            {newKeyValue ? (
              <>
                <CardHeader>
                  <Heading level={3} size="lg" style={{ marginBottom: 'var(--space-2)' }}>
                    API-ключ создан
                  </Heading>
                </CardHeader>
                <CardBody>
                  <div style={{
                    background: 'var(--color-warning-subtle, #fef3c7)',
                    border: '1px solid var(--color-warning, #f59e0b)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    marginBottom: 'var(--space-4)',
                  }}>
                    <Text size="sm" style={{ color: 'var(--color-warning-text, #92400e)' }}>
                      Скопируйте ключ сейчас. После закрытия окна он больше не будет показан.
                    </Text>
                  </div>

                  <div style={{
                    display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
                    background: 'var(--color-surface-raised)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    marginBottom: 'var(--space-4)',
                  }}>
                    <Mono size="sm" style={{ flex: 1, wordBreak: 'break-all' }}>
                      {newKeyValue}
                    </Mono>
                    <Button
                      variant={copied ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => handleCopy(newKeyValue)}
                      style={{ flexShrink: 0 }}
                    >
                      {copied ? 'Скопировано' : 'Копировать'}
                    </Button>
                  </div>

                  <Button variant="primary" size="sm" onClick={closeNewKey}>
                    Закрыть
                  </Button>
                </CardBody>
              </>
            ) : (
              <>
                <CardHeader>
                  <Heading level={3} size="lg" style={{ marginBottom: 'var(--space-2)' }}>
                    Новый API-ключ
                  </Heading>
                </CardHeader>
                <CardBody>
                  <form onSubmit={handleCreate}>
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                      <label
                        htmlFor="key-name"
                        style={{
                          display: 'block',
                          marginBottom: 'var(--space-1)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-wider)',
                          color: 'var(--color-text-tertiary)',
                        }}
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
                        style={{
                          width: '100%',
                          padding: 'var(--space-2) var(--space-3)',
                          fontFamily: 'var(--font-sans)',
                          fontSize: 'var(--text-sm)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-surface)',
                          color: 'var(--color-text-primary)',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
                </CardBody>
              </>
            )}
          </Card>
        </div>
      )}

      {/* ─── Секция 1: Управление ключами ────────────────────────── */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <Heading level={2} size="xl" style={{ marginBottom: 'var(--space-4)' }}>
          Активные ключи
        </Heading>

        {loadingKeys ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
            <Spinner size="md" />
          </div>
        ) : apiKeys.length === 0 ? (
          <Card variant="outlined" padding="md">
            <Text color="tertiary">Нет активных API-ключей. Создайте первый ключ с помощью кнопки выше.</Text>
          </Card>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-strong)' }}>
                  {['Название', 'Префикс ключа', 'Создан', 'Последнее использование', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: 'var(--space-3) var(--space-4)',
                        textAlign: 'left',
                        color: 'var(--color-text-tertiary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-wider)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-primary)' }}>
                      {key.name}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <Mono size="sm" style={{ color: 'var(--color-text-secondary)' }}>
                        {key.keyPrefix}...
                      </Mono>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <Mono size="xs" color="var(--color-text-tertiary)">
                        {new Date(key.createdAt).toLocaleDateString('ru-RU')}
                      </Mono>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      {key.lastUsedAt ? (
                        <Mono size="xs" color="var(--color-text-tertiary)">
                          {new Date(key.lastUsedAt).toLocaleDateString('ru-RU')}
                        </Mono>
                      ) : (
                        <Badge variant="default">Не использовался</Badge>
                      )}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
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

      {/* ─── Секция 2: Инструкция по подключению ─────────────────── */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <Heading level={2} size="xl" style={{ marginBottom: 'var(--space-4)' }}>
              Как подключиться к API
            </Heading>
          </CardHeader>
          <CardBody>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Text size="sm" color="secondary" style={{ marginBottom: 'var(--space-2)' }}>
                Base URL
              </Text>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)',
              }}>
                <Mono size="sm" style={{ flex: 1 }}>{proxyBase}</Mono>
              </div>
            </div>

            <div>
              <Text size="sm" color="secondary" style={{ marginBottom: 'var(--space-2)' }}>
                Аутентификация
              </Text>
              <Text size="sm" style={{ marginBottom: 'var(--space-2)' }}>
                Добавьте заголовок <Mono size="sm">Authorization</Mono> к каждому запросу:
              </Text>
              <CodeBlock>{`Authorization: Bearer ваш_api_ключ`}</CodeBlock>
            </div>
          </CardBody>
        </Card>
      </section>

      {/* ─── Секция 3: Примеры запросов ──────────────────────────── */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <Heading level={2} size="xl" style={{ marginBottom: 'var(--space-4)' }}>
          Примеры запросов
        </Heading>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <ExampleCard
            title="Список учеников"
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  ${proxyBase}/users`}
          />
          <ExampleCard
            title="Задания ученика"
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  '${proxyBase}/student-assignments?studentId=ID_УЧЕНИКА'`}
          />
          <ExampleCard
            title="Список потоков"
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  ${proxyBase}/streams`}
          />
          <ExampleCard
            title="Профиль ученика"
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  ${proxyBase}/profiles/ID_УЧЕНИКА`}
          />
          <ExampleCard
            title="Лента ученика (thread)"
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  ${proxyBase}/threads/ID_УЧЕНИКА`}
          />
          <ExampleCard
            title="Отправить комментарий в ленту"
            code={`curl -X POST -H 'Authorization: Bearer sk_ваш_ключ' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"type": "comment", "content": "Отличная работа!"}' \\\n  ${proxyBase}/threads/ID_УЧЕНИКА/entries`}
          />
        </div>
      </section>
    </DashboardLayout>
  );
}

// ─── Вспомогательные компоненты ───────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <div style={{
      background: 'var(--color-surface-raised)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3)',
      overflowX: 'auto',
    }}>
      <Mono size="sm" style={{ whiteSpace: 'pre', display: 'block' }}>{children}</Mono>
    </div>
  );
}

function ExampleCard({ title, code }: { title: string; code: string }) {
  return (
    <Card variant="outlined" padding="md">
      <CardHeader>
        <Text size="sm" style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>{title}</Text>
      </CardHeader>
      <CardBody>
        <CodeBlock>{code}</CodeBlock>
      </CardBody>
    </Card>
  );
}

// ─── Inline icons ──────────────────────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" /><rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" /><path d="M1 14c0-3 2-5 5-5s5 2 5 5" /><circle cx="12" cy="4" r="2" /><path d="M15 13c0-2-1-4-3-4" />
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
function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
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
