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
import { PageHeader } from '@platform/ui/templates';
import { Card, FormField } from '@platform/ui/molecules';
import { Button, Input, Badge, Heading, Text, Mono, Spinner } from '@platform/ui/atoms';

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
      <PageHeader
        title="Потоки"
        subtitle="Учебные группы и их уроки"
        action={
          <Button
            variant={showCreateForm ? 'ghost' : 'primary'}
            size="sm"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? 'Отмена' : 'Создать поток'}
          </Button>
        }
      />

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--spacing-4)' }}>
          <Text size="sm" color="var(--color-error)">{error}</Text>
        </Card>
      )}

      {showCreateForm && (
        <Card variant="elevated" padding="md" style={{ marginBottom: 'var(--spacing-6)' }}>
          <Heading level={3} size="lg" style={{ marginBottom: 'var(--spacing-4)' }}>Новый поток</Heading>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <FormField
                  id="new-stream-name"
                  label="Название потока"
                  required
                  inputProps={{
                    placeholder: 'Например: Поток #1',
                    value: newName,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value),
                    autoFocus: true,
                  }}
                />
              </div>
              <Button type="submit" variant="primary" size="md" loading={creating} disabled={!newName.trim()}>
                Создать
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loadingStreams ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
          <Spinner size="md" />
        </div>
      ) : streams.length === 0 ? (
        <Text color="tertiary">Потоков пока нет. Создайте первый поток.</Text>
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
                          size="sm"
                          autoFocus
                          style={{ maxWidth: 250 }}
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleUpdate(stream.id)}
                          loading={saving}
                          disabled={!editName.trim()}
                        >
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
                      <Text size="sm" weight="medium" as="span">{stream.name}</Text>
                    )}
                  </td>
                  <td style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}>
                    <Badge variant={stream.status === 'active' ? 'success' : 'error'}>
                      {stream.status === 'active' ? 'Активный' : 'Архивный'}
                    </Badge>
                  </td>
                  <td style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}>
                    <Mono size="xs" color="var(--color-text-tertiary)">
                      {new Date(stream.createdAt).toLocaleDateString('ru-RU')}
                    </Mono>
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
                          <Button variant="danger" size="sm" onClick={() => handleArchive(stream.id)}>
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
