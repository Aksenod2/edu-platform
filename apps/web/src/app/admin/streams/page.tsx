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

export default function StreamsPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

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

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'admin') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => router.push('/admin')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
          >
            &larr; Назад к панели
          </button>
          <h1 style={{ margin: 0 }}>Потоки</h1>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{
            padding: '8px 16px',
            background: '#0070f3',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {showCreateForm ? 'Отмена' : 'Создать поток'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00' }}>
          {error}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} style={{ marginBottom: 24, padding: 16, background: '#f9f9f9', borderRadius: 8, border: '1px solid #eee' }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Название потока</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Например: Поток #1"
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
              autoFocus
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              style={{
                padding: '8px 16px',
                background: creating ? '#ccc' : '#0070f3',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: creating ? 'default' : 'pointer',
                fontSize: 14,
              }}
            >
              {creating ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      )}

      {loadingStreams ? (
        <p>Загрузка потоков...</p>
      ) : streams.length === 0 ? (
        <p style={{ color: '#666' }}>Потоков пока нет. Создайте первый поток.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Название</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Статус</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Создан</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {streams.map((stream) => (
              <tr key={stream.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px' }}>
                  {editingId === stream.id ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ flex: 1, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
                        autoFocus
                      />
                      <button
                        onClick={() => handleUpdate(stream.id)}
                        disabled={saving || !editName.trim()}
                        style={{ padding: '4px 8px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        {saving ? '...' : 'Сохранить'}
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditName(''); }}
                        style={{ padding: '4px 8px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    stream.name
                  )}
                </td>
                <td style={{ padding: '12px' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 'bold',
                      background: stream.status === 'active' ? '#e6f4ea' : '#f4e6e6',
                      color: stream.status === 'active' ? '#1a7f37' : '#9a3030',
                    }}
                  >
                    {stream.status === 'active' ? 'Активный' : 'Архивный'}
                  </span>
                </td>
                <td style={{ padding: '12px', color: '#666', fontSize: 14 }}>
                  {new Date(stream.createdAt).toLocaleDateString('ru-RU')}
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  {editingId !== stream.id && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => router.push(`/admin/streams/${stream.id}/lessons`)}
                        style={{ padding: '4px 12px', background: '#e8f4fd', border: '1px solid #b3d9f2', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#0070f3' }}
                      >
                        Уроки
                      </button>
                      <button
                        onClick={() => router.push(`/admin/streams/${stream.id}/assignments`)}
                        style={{ padding: '4px 12px', background: '#f0e8fd', border: '1px solid #d5b3f2', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#7c3aed' }}
                      >
                        Задания
                      </button>
                      <button
                        onClick={() => { setEditingId(stream.id); setEditName(stream.name); }}
                        style={{ padding: '4px 12px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Редактировать
                      </button>
                      {stream.status === 'active' && (
                        <button
                          onClick={() => handleArchive(stream.id)}
                          style={{ padding: '4px 12px', background: '#fee', border: '1px solid #fcc', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#c00' }}
                        >
                          Архивировать
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
