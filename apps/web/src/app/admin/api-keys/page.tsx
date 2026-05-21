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
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ApiKeysPage() {
  const { accessToken } = useAuth();

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

  const proxyBase = baseUrl ? `${baseUrl}/api-proxy` : '/api-proxy';

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API-ключи</h1>
          <p className="text-sm text-muted-foreground">Управление ключами для внешних интеграций</p>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowCreateModal(true); setNewKeyValue(null); }}
        >
          + Создать ключ
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md bg-muted border p-6 rounded-md">
            {newKeyValue ? (
              <>
                <h3 className="font-mono text-sm font-bold tracking-widest uppercase text-foreground mb-4">
                  API-ключ создан
                </h3>
                <Alert className="mb-4">
                  <AlertDescription>
                    Скопируйте ключ сейчас. После закрытия окна он больше не будет показан.
                  </AlertDescription>
                </Alert>
                <div className="flex items-center gap-2 mb-4 px-3 py-3 bg-card border rounded-md">
                  <code className="flex-1 font-mono text-xs text-foreground break-all">
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
                <Button size="sm" onClick={closeNewKey}>
                  Закрыть
                </Button>
              </>
            ) : (
              <>
                <h3 className="font-mono text-sm font-bold tracking-widest uppercase text-foreground mb-4">
                  Новый API-ключ
                </h3>
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
              </>
            )}
          </div>
        </div>
      )}

      {/* Keys table */}
      <section className="mb-8">
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-muted-foreground mb-4">
          Активные ключи
        </h2>

        {loadingKeys ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground border rounded-md">
            <span className="font-mono text-xs uppercase tracking-wider">
              Нет активных API-ключей
            </span>
            <span className="text-sm">
              Создайте первый ключ с помощью кнопки выше
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  {['Название', 'Префикс ключа', 'Создан', 'Последнее использование', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left font-mono text-xs uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-b hover:bg-muted transition-colors">
                    <td className="px-4 py-3 text-foreground text-sm">
                      {key.name}
                    </td>
                    <td className="px-4 py-3">
                      <code className="font-mono text-xs text-muted-foreground">
                        {key.keyPrefix}...
                      </code>
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

      {/* Connection guide */}
      <section className="mb-8">
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-muted-foreground mb-4">
          Подключение к API
        </h2>
        <div className="border bg-card p-5 rounded-md">
          <div className="mb-4">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Base URL
            </p>
            <div className="flex items-center gap-2 px-3 py-2 bg-muted border rounded-md">
              <code className="font-mono text-xs text-foreground flex-1">{proxyBase}</code>
            </div>
          </div>

          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Аутентификация
            </p>
            <p className="text-sm text-muted-foreground mb-2">
              Добавьте заголовок <code className="font-mono text-xs bg-muted px-1">Authorization</code> к каждому запросу:
            </p>
            <div className="px-3 py-3 bg-muted border rounded-md">
              <code className="font-mono text-xs text-foreground whitespace-pre">
                {`Authorization: Bearer ваш_api_ключ`}
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* API examples */}
      <section className="mb-8">
        <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-muted-foreground mb-4">
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
            <div key={title} className="border bg-card rounded-md">
              <div className="px-4 py-2 border-b">
                <span className="font-mono text-xs font-bold tracking-wider uppercase text-muted-foreground">
                  {title}
                </span>
              </div>
              <div className="px-4 py-3 overflow-x-auto">
                <code className="font-mono text-xs text-foreground whitespace-pre">
                  {code}
                </code>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
