'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getSchedule,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  type Stream,
  type ScheduleEntry,
} from '@/lib/api';

export default function SchedulePage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('');
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editLessonTitle, setEditLessonTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  // Load streams
  useEffect(() => {
    if (!accessToken || !user || user.role !== 'admin') return;
    getStreams(accessToken)
      .then((data) => {
        setStreams(data.streams);
        if (data.streams.length > 0 && !selectedStreamId) {
          setSelectedStreamId(data.streams[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков'));
  }, [accessToken, user, selectedStreamId]);

  const fetchSchedule = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingEntries(true);
    try {
      const data = await getSchedule(accessToken, selectedStreamId);
      setEntries(data.schedule);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки расписания');
    } finally {
      setLoadingEntries(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (selectedStreamId) fetchSchedule();
  }, [selectedStreamId, fetchSchedule]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !selectedStreamId || !newDate || !newStartTime || !newLessonTitle.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createScheduleEntry(accessToken, {
        streamId: selectedStreamId,
        date: newDate,
        startTime: newStartTime,
        lessonTitle: newLessonTitle.trim(),
        notes: newNotes.trim() || undefined,
      });
      setNewDate('');
      setNewStartTime('');
      setNewLessonTitle('');
      setNewNotes('');
      setShowCreateForm(false);
      await fetchSchedule();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания записи');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (entry: ScheduleEntry) => {
    setEditingId(entry.id);
    setEditDate(entry.date.slice(0, 10));
    setEditStartTime(entry.startTime);
    setEditLessonTitle(entry.lessonTitle);
    setEditNotes(entry.notes || '');
  };

  const handleUpdate = async (id: string) => {
    if (!accessToken || !editLessonTitle.trim()) return;
    setSaving(true);
    setError('');
    try {
      await updateScheduleEntry(accessToken, id, {
        date: editDate,
        startTime: editStartTime,
        lessonTitle: editLessonTitle.trim(),
        notes: editNotes.trim() || null,
      });
      setEditingId(null);
      await fetchSchedule();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления записи');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    if (!confirm('Удалить запись из расписания?')) return;
    setError('');
    try {
      await deleteScheduleEntry(accessToken, id);
      await fetchSchedule();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления записи');
    }
  };

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'admin') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => router.push('/admin')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
          >
            &larr; Назад к панели
          </button>
          <h1 style={{ margin: 0 }}>Расписание</h1>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          disabled={!selectedStreamId}
          style={{
            padding: '8px 16px',
            background: selectedStreamId ? '#0070f3' : '#ccc',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: selectedStreamId ? 'pointer' : 'default',
            fontSize: 14,
          }}
        >
          {showCreateForm ? 'Отмена' : 'Добавить занятие'}
        </button>
      </div>

      {/* Stream selector */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontWeight: 'bold', marginRight: 8 }}>Поток:</label>
        <select
          value={selectedStreamId}
          onChange={(e) => setSelectedStreamId(e.target.value)}
          style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
        >
          {streams.length === 0 && <option value="">Нет потоков</option>}
          {streams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.status === 'archived' ? '(архив)' : ''}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00' }}>
          {error}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} style={{ marginBottom: 24, padding: 16, background: '#f9f9f9', borderRadius: 8, border: '1px solid #eee' }}>
          <h3 style={{ margin: '0 0 12px 0' }}>Новое занятие</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 'bold' }}>Дата</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 'bold' }}>Время начала</label>
              <input
                type="time"
                value={newStartTime}
                onChange={(e) => setNewStartTime(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 'bold' }}>Название урока</label>
            <input
              type="text"
              value={newLessonTitle}
              onChange={(e) => setNewLessonTitle(e.target.value)}
              placeholder="Например: Основы типографики"
              required
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 'bold' }}>Тезисы (опционально, markdown)</label>
            <textarea
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Краткое описание того, что будет на занятии..."
              rows={3}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newDate || !newStartTime || !newLessonTitle.trim()}
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
        </form>
      )}

      {loadingEntries ? (
        <p>Загрузка расписания...</p>
      ) : !selectedStreamId ? (
        <p style={{ color: '#666' }}>Выберите поток для просмотра расписания.</p>
      ) : entries.length === 0 ? (
        <p style={{ color: '#666' }}>Расписание пока пусто. Добавьте первое занятие.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Дата</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Время</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Урок</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Тезисы</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} style={{ borderBottom: '1px solid #eee' }}>
                {editingId === entry.id ? (
                  <>
                    <td style={{ padding: 12 }}>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: 12 }}>
                      <input
                        type="time"
                        value={editStartTime}
                        onChange={(e) => setEditStartTime(e.target.value)}
                        style={{ padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: 12 }}>
                      <input
                        type="text"
                        value={editLessonTitle}
                        onChange={(e) => setEditLessonTitle(e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
                      />
                    </td>
                    <td style={{ padding: 12 }}>
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={2}
                        style={{ width: '100%', padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                      />
                    </td>
                    <td style={{ padding: 12, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleUpdate(entry.id)}
                          disabled={saving || !editLessonTitle.trim()}
                          style={{ padding: '4px 8px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                        >
                          {saving ? '...' : 'Сохранить'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{ padding: '4px 8px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                        >
                          Отмена
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      {new Date(entry.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </td>
                    <td style={{ padding: 12, fontSize: 14 }}>{entry.startTime}</td>
                    <td style={{ padding: 12, fontWeight: 500 }}>{entry.lessonTitle}</td>
                    <td style={{ padding: 12, fontSize: 13, color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.notes || '—'}
                    </td>
                    <td style={{ padding: 12, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => startEdit(entry)}
                          style={{ padding: '4px 12px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                        >
                          Редактировать
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          style={{ padding: '4px 12px', background: '#fee', border: '1px solid #fcc', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#c00' }}
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
