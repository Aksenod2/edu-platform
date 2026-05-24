'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
} from '@/lib/api';
import { API_ENDPOINTS, API_ENDPOINT_GROUPS } from '@/lib/api-endpoints';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

export default function ApiAccessPage() {
  const { accessToken } = useAuth();

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);

  // Создание ключа
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  // Отзыв ключа
  const [revoking, setRevoking] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);

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
                        Ключ даёт ПОЛНЫЕ права администратора и не имеет срока действия (бессрочный).
                        Храните его в секрете и отзывайте при компрометации. Утечка ключа = доступ к
                        кошелькам, сбросу паролей и экспорту данных учеников.
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

      {/* ─── Подтверждение отзыва ключа ───────────────────────────── */}
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

      {/* ─── Секция 2: Инструкция по подключению ─────────────────── */}
      <section className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Как подключиться к API</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>
                <span className="font-semibold">Внимание: ключ = полные права администратора, бессрочный.</span>{' '}
                Утечка ключа даёт доступ к кошелькам учеников, сбросу паролей и экспорту персональных
                данных. Действия по ключу <span className="font-semibold">не аудируются</span> — фиксируется
                только дата последнего использования (<span className="font-mono text-xs">lastUsedAt</span>),
                без журнала операций. Храните ключ в секрете, не передавайте третьим лицам и немедленно
                отзывайте при подозрении на компрометацию.
              </AlertDescription>
            </Alert>

            <div className="mb-6">
              <p className="text-sm text-muted-foreground mb-2">Аутентификация</p>
              <p className="text-sm mb-2">
                Добавьте заголовок <span className="font-mono text-xs">Authorization</span> к каждому запросу. В качестве токена используйте API-ключ
                {' '}(начинается с <span className="font-mono text-xs">sk_</span>):
              </p>
              <CodeBlock>{`Authorization: Bearer sk_<ваш_ключ>`}</CodeBlock>
              <p className="text-sm text-muted-foreground mt-2">
                Ключ работает с правами своего владельца — то есть с полными правами администратора. Срока
                действия нет, ключ бессрочный. Храните его в секрете и отзывайте при компрометации.
              </p>
            </div>

            <div className="mb-6">
              <p className="text-sm text-muted-foreground mb-2">Особенности отдельных доменов</p>
              <ul className="text-sm list-disc pl-5 flex flex-col gap-2">
                <li>
                  <span className="font-medium">Ленты, треды и чаты — append-only.</span> Записи можно только
                  добавлять (<span className="font-mono text-xs">POST .../entries</span>) и отмечать
                  прочитанными; правки и удаления отдельных записей нет (как и в веб-интерфейсе).
                </li>
                <li>
                  <span className="font-medium">Отключение Zoom.</span> Отдельного эндпоинта удаления нет:
                  чтобы отключить интеграцию, сохраните пустые credentials через{' '}
                  <span className="font-mono text-xs">PUT /admin/integrations/zoom</span>.
                </li>
              </ul>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Базовый URL</p>
              <p className="text-sm mb-2">
                В примерах ниже используется прокси веб-приложения — он сам пробрасывает токен к API:
              </p>
              <div className="flex items-center gap-2 px-3 py-2 bg-muted border rounded-md mb-2">
                <span className="font-mono text-xs flex-1">{proxyBase}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Можно обращаться и напрямую к API — по его собственному адресу (зависит от окружения; запросите его у администратора инфраструктуры).
                Заголовок <span className="font-mono text-xs">Authorization</span> в этом случае добавляйте сами.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── Секция 3: Полный список эндпоинтов ───────────────────── */}
      <section className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Все эндпоинты ({API_ENDPOINTS.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Полный перечень эндпоинтов, доступных по API-ключу (права администратора).
              Параметры пути указаны в стиле <code className="font-mono text-xs">:id</code>.
              Списочные эндпоинты принимают фильтры через query-параметры (например,{' '}
              <code className="font-mono text-xs">/student-assignments?studentId=ID</code>).
            </p>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Метод</TableHead>
                    <TableHead>Путь</TableHead>
                    <TableHead>Описание</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {API_ENDPOINT_GROUPS.map((group) => {
                    const rows = API_ENDPOINTS.filter((e) => e.group === group);
                    if (rows.length === 0) return null;
                    return (
                      <GroupRows key={group} group={group} rows={rows} />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── Секция 4: Примеры запросов ──────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">Примеры запросов</h2>

        <div className="flex flex-col gap-4">
          <ExampleCard
            title="Список учеников"
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  ${proxyBase}/users`}
          />
          <ExampleCard
            title="Скачать всё по студенту"
            description="Удобная выгрузка одним запросом: профиль, задания, лента и список файлов с подписанными ссылками."
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  ${proxyBase}/users/ID_УЧЕНИКА/export`}
          />
          <ExampleCard
            title="Задания ученика"
            code={`curl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  '${proxyBase}/student-assignments?studentId=ID_УЧЕНИКА'`}
          />
          <ExampleCard
            title="Список групп"
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

      {/* ─── Секция 5: Файлы и подписанные ссылки ─────────────────── */}
      <section className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Файлы и подписанные ссылки</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm list-disc pl-5 flex flex-col gap-2">
              <li>
                Ответы API содержат подписанные ссылки на файлы (поля <span className="font-mono text-xs">fileUrl</span> /{' '}
                <span className="font-mono text-xs">signedUrl</span>). Такая ссылка действует около часа.
              </li>
              <li>
                По подписанной ссылке файл скачивается без заголовка <span className="font-mono text-xs">Authorization</span> — подпись уже встроена в URL.
              </li>
              <li>
                С админским ключом можно дёргать <span className="font-mono text-xs">GET /files/*</span> напрямую, передав
                {' '}<span className="font-mono text-xs">Authorization: Bearer sk_...</span> вместо подписи.
              </li>
              <li>Прямого публичного доступа к файлам больше нет: нужна либо валидная подпись, либо админский Bearer.</li>
            </ul>
            <div className="mt-4">
              <CodeBlock>{`# Скачать файл по подписанной ссылке из ответа API (без токена)\ncurl -L -o file 'ССЫЛКА_ИЗ_ОТВЕТА_API'\n\n# Либо напрямую с админским ключом\ncurl -H 'Authorization: Bearer sk_ваш_ключ' \\\n  -o file '${proxyBase}/files/КЛЮЧ_ФАЙЛА'`}</CodeBlock>
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

// ─── Вспомогательные компоненты ───────────────────────────────────────────────

function GroupRows({
  group,
  rows,
}: {
  group: string;
  rows: typeof API_ENDPOINTS;
}) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={3} className="font-semibold text-foreground">
          {group}
        </TableCell>
      </TableRow>
      {rows.map((e) => (
        <TableRow key={`${e.method} ${e.path}`} className="align-top">
          <TableCell>
            <Badge variant="outline" className="font-mono text-[11px]">{e.method}</Badge>
          </TableCell>
          <TableCell>
            <code className="font-mono text-xs whitespace-nowrap">{e.path}</code>
          </TableCell>
          <TableCell className="text-muted-foreground">{e.desc}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="bg-muted border rounded-md p-3 overflow-x-auto">
      <span className="font-mono text-xs whitespace-pre block">{children}</span>
    </div>
  );
}

function ExampleCard({ title, code, description }: { title: string; code: string; description?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {description && <p className="text-sm text-muted-foreground mb-2">{description}</p>}
        <CodeBlock>{code}</CodeBlock>
      </CardContent>
    </Card>
  );
}
