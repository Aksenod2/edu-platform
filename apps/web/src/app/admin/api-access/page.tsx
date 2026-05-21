'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
} from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ApiAccessPage() {
  const { accessToken } = useAuth();

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

  const proxyBase = baseUrl ? `${baseUrl}/api-proxy` : '/api-proxy';

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API-доступ</h1>
          <p className="text-sm text-muted-foreground">Управление API-ключами и документация по интеграции</p>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowCreateModal(true); setNewKeyValue(null); }}
        >
          Создать API-ключ
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ─── Модальное окно создания ключа ───────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45">
          <Card className="w-full max-w-md">
            {newKeyValue ? (
              <>
                <CardHeader>
                  <CardTitle>API-ключ создан</CardTitle>
                </CardHeader>
                <CardContent>
                  <Alert className="mb-4">
                    <AlertDescription>
                      Скопируйте ключ сейчас. После закрытия окна он больше не будет показан.
                    </AlertDescription>
                  </Alert>

                  <div className="flex items-center gap-2 mb-4 px-3 py-3 bg-muted border rounded-md">
                    <span className="flex-1 font-mono text-xs break-all">
                      {newKeyValue}
                    </span>
                    <Button
                      variant={copied ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => handleCopy(newKeyValue)}
                      className="shrink-0"
                    >
                      {copied ? 'Скопировано' : 'Копировать'}
                    </Button>
                  </div>

                  <Button size="sm" onClick={closeNewKey}>
                    Закрыть
                  </Button>
                </CardContent>
              </>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>Новый API-ключ</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreate}>
                    <div className="flex flex-col gap-2 mb-4">
                      <Label htmlFor="key-name">Название ключа</Label>
                      <Input
                        id="key-name"
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="Например: Интеграция с CRM"
                        required
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={creating}>
                        {creating && <Loader2 className="animate-spin" />}
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
                </CardContent>
              </>
            )}
          </Card>
        </div>
      )}

      {/* ─── Секция 1: Управление ключами ────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">Активные ключи</h2>

        {loadingKeys ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : apiKeys.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">Нет активных API-ключей. Создайте первый ключ с помощью кнопки выше.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  {['Название', 'Префикс ключа', 'Создан', 'Последнее использование', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-muted-foreground font-mono text-xs uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-b">
                    <td className="px-4 py-3 text-foreground">
                      {key.name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {key.keyPrefix}...
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(key.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {key.lastUsedAt ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {new Date(key.lastUsedAt).toLocaleDateString('ru-RU')}
                        </span>
                      ) : (
                        <Badge variant="outline">Не использовался</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={revoking === key.id}
                        onClick={() => handleRevoke(key)}
                      >
                        {revoking === key.id && <Loader2 className="animate-spin" />}
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
      <section className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Как подключиться к API</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <p className="text-sm text-muted-foreground mb-2">
                Base URL
              </p>
              <div className="flex items-center gap-2 px-3 py-2 bg-muted border rounded-md">
                <span className="font-mono text-xs flex-1">{proxyBase}</span>
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Аутентификация
              </p>
              <p className="text-sm mb-2">
                Добавьте заголовок <span className="font-mono text-xs">Authorization</span> к каждому запросу:
              </p>
              <CodeBlock>{`Authorization: Bearer ваш_api_ключ`}</CodeBlock>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── Секция 3: Примеры запросов ──────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">Примеры запросов</h2>

        <div className="flex flex-col gap-4">
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
    </>
  );
}

// ─── Вспомогательные компоненты ───────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="bg-muted border rounded-md p-3 overflow-x-auto">
      <span className="font-mono text-xs whitespace-pre block">{children}</span>
    </div>
  );
}

function ExampleCard({ title, code }: { title: string; code: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CodeBlock>{code}</CodeBlock>
      </CardContent>
    </Card>
  );
}
