'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
} from '@/lib/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function ApiKeysPage() {
  const { accessToken } = useAuth();

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  const [revoking, setRevoking] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки ключей');
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
      toast.error(err instanceof Error ? err.message : 'Ошибка создания ключа');
      setShowCreateModal(false);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    if (!accessToken) return;
    setRevoking(key.id);
    try {
      await revokeApiKey(accessToken, key.id);
      await fetchKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отзыва ключа');
    } finally {
      setRevoking(null);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Ключ скопирован');
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
          Создать ключ
        </Button>
      </div>

      {/* Modal */}
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
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(newKeyValue)}
                      className="shrink-0"
                    >
                      Копировать
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
                      <p className="text-xs text-muted-foreground">
                        Ключ даёт полный админ-доступ к API и не имеет срока действия. Храните в секрете.
                      </p>
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

      {/* Подтверждение отзыва ключа */}
      <AlertDialog open={!!keyToRevoke} onOpenChange={(open) => { if (!open) setKeyToRevoke(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отозвать ключ?</AlertDialogTitle>
            <AlertDialogDescription>
              {keyToRevoke && `Ключ «${keyToRevoke.name}» будет отозван. Это действие необратимо.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (keyToRevoke) handleRevoke(keyToRevoke); }}
            >
              Отозвать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Keys table */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">Активные ключи</h2>

        {loadingKeys ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-12 text-center text-muted-foreground border rounded-lg">
            <span className="text-sm font-medium">Нет активных API-ключей</span>
            <span className="text-sm">Создайте первый ключ с помощью кнопки выше</span>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Префикс ключа</TableHead>
                  <TableHead>Создан</TableHead>
                  <TableHead>Последнее использование</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {key.keyPrefix}...
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(key.createdAt).toLocaleDateString('ru-RU')}
                      </span>
                    </TableCell>
                    <TableCell>
                      {key.lastUsedAt ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {new Date(key.lastUsedAt).toLocaleDateString('ru-RU')}
                        </span>
                      ) : (
                        <Badge variant="outline">Не использовался</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={revoking === key.id}
                        onClick={() => setKeyToRevoke(key)}
                      >
                        {revoking === key.id && <Loader2 className="animate-spin" />}
                        Отозвать
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Connection guide */}
      <section className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Подключение к API</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
              <p className="text-sm text-muted-foreground mb-2">Базовый URL</p>
              <div className="flex items-center gap-2 px-3 py-2 bg-muted border rounded-md">
                <span className="font-mono text-xs flex-1">{proxyBase}</span>
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Аутентификация</p>
              <p className="text-sm mb-2">
                Добавьте заголовок <span className="font-mono text-xs">Authorization</span> к каждому запросу:
              </p>
              <div className="bg-muted border rounded-md p-3 overflow-x-auto">
                <span className="font-mono text-xs whitespace-pre block">
                  {`Authorization: Bearer ваш_api_ключ`}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* API examples */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">Примеры запросов</h2>
        <div className="flex flex-col gap-4">
          {[
            { title: 'Список студентов',  code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/users` },
            { title: 'Задания студента',  code: `curl -H 'Authorization: Bearer sk_...' \\\n  '${proxyBase}/student-assignments?studentId=ID'` },
            { title: 'Список групп',     code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/streams` },
            { title: 'Профиль студента',  code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/profiles/ID` },
            { title: 'Лента студента',    code: `curl -H 'Authorization: Bearer sk_...' \\\n  ${proxyBase}/threads/ID` },
          ].map(({ title, code }) => (
            <Card key={title}>
              <CardHeader>
                <CardTitle className="text-sm">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted border rounded-md p-3 overflow-x-auto">
                  <span className="font-mono text-xs whitespace-pre block">{code}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
