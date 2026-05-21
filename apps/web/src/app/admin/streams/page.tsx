'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  createStream,
  updateStream,
  archiveStream,
  type Stream,
} from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function StreamsPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [error, setError] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchStreams = useCallback(async () => {
    if (!accessToken) return;
    setLoadingStreams(true);
    try {
      const data = await getStreams(accessToken);
      setStreams(data.streams);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков');
    } finally {
      setLoadingStreams(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchStreams();
    }
  }, [accessToken, user, fetchStreams]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createStream(accessToken, newName.trim());
      setNewName('');
      setShowCreateForm(false);
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания потока');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!accessToken || !editName.trim()) return;
    setSaving(true);
    setError('');
    try {
      await updateStream(accessToken, id, editName.trim());
      setEditingId(null);
      setEditName('');
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления потока');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!accessToken) return;
    if (!confirm('Вы уверены, что хотите архивировать этот поток?')) return;
    setError('');
    try {
      await archiveStream(accessToken, id);
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка архивирования потока');
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Потоки</h1>
          <p className="text-sm text-muted-foreground">Учебные группы и их уроки</p>
        </div>
        <Button
          variant={showCreateForm ? 'ghost' : 'default'}
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? 'Отмена' : 'Создать поток'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showCreateForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Новый поток</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate}>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Field>
                    <FieldLabel htmlFor="new-stream-name">Название потока</FieldLabel>
                    <Input
                      id="new-stream-name"
                      placeholder="Например: Поток #1"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      autoFocus
                      required
                    />
                  </Field>
                </div>
                <Button type="submit" variant="default" disabled={creating || !newName.trim()}>
                  {creating && <Loader2 className="animate-spin" />}
                  Создать
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loadingStreams ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : streams.length === 0 ? (
        <p className="text-sm text-muted-foreground">Потоков пока нет. Создайте первый поток.</p>
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
                {['Название', 'Статус', 'Создан', 'Действия'].map((h) => (
                  <th key={h} style={{ padding: 'var(--spacing-3) var(--spacing-4)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streams.map((stream) => (
                <tr key={stream.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <td style={{ padding: 'var(--spacing-3) var(--spacing-4)', color: 'var(--color-text-primary)' }}>
                    {editingId === stream.id ? (
                      <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          style={{ maxWidth: 250 }}
                        />
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleUpdate(stream.id)}
                          disabled={saving || !editName.trim()}
                        >
                          {saving && <Loader2 className="animate-spin" />}
                          Сохранить
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditingId(null); setEditName(''); }}
                        >
                          Отмена
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm font-medium">{stream.name}</span>
                    )}
                  </td>
                  <td style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}>
                    <Badge variant={stream.status === 'active' ? 'default' : 'destructive'}>
                      {stream.status === 'active' ? 'Активный' : 'Архивный'}
                    </Badge>
                  </td>
                  <td style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(stream.createdAt).toLocaleDateString('ru-RU')}
                    </span>
                  </td>
                  <td style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}>
                    {editingId !== stream.id && (
                      <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                        <Button variant="secondary" size="sm" onClick={() => router.push(`/admin/streams/${stream.id}/lessons`)}>
                          Уроки
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => router.push(`/admin/streams/${stream.id}/assignments`)}>
                          Задания
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setEditingId(stream.id); setEditName(stream.name); }}>
                          Редактировать
                        </Button>
                        {stream.status === 'active' && (
                          <Button variant="destructive" size="sm" onClick={() => handleArchive(stream.id)}>
                            Архивировать
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
