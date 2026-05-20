'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getLessons,
  createLesson,
  updateLesson,
  deleteLesson,
  getStreams,
  type Lesson,
  type Stream,
} from '@/lib/api';

type LessonFormData = {
  title: string;
  videoUrl: string;
  summary: string;
  notes: string;
  publishAt: string;
  sortOrder: number;
  status: 'draft' | 'published' | 'closed';
};

const emptyForm: LessonFormData = {
  title: '',
  videoUrl: '',
  summary: '',
  notes: '',
  publishAt: '',
  sortOrder: 0,
  status: 'draft',
};

const statusLabels: Record<string, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  closed: 'Закрыт',
};

const statusColors: Record<string, { bg: string; color: string }> = {
  draft: { bg: '#fff3cd', color: '#856404' },
  published: { bg: '#e6f4ea', color: '#1a7f37' },
  closed: { bg: '#f4e6e6', color: '#9a3030' },
};

export default function LessonsPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const streamId = params.streamId as string;

  const [stream, setStream] = useState<Stream | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [error, setError] = useState('');

  // Create / edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LessonFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchData = useCallback(async () => {
    if (!accessToken || !streamId) return;
    setLoadingLessons(true);
    try {
      const [streamsData, lessonsData] = await Promise.all([
        getStreams(accessToken),
        getLessons(accessToken, streamId),
      ]);
      const found = streamsData.streams.find((s) => s.id === streamId);
      setStream(found || null);
      setLessons(lessonsData.lessons);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingLessons(false);
    }
  }, [accessToken, streamId]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchData();
    }
  }, [accessToken, user, fetchData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (lesson: Lesson) => {
    setEditingId(lesson.id);
    setForm({
      title: lesson.title,
      videoUrl: lesson.videoUrl || '',
      summary: lesson.summary || '',
      notes: lesson.notes || '',
      publishAt: lesson.publishAt ? lesson.publishAt.slice(0, 16) : '',
      sortOrder: lesson.sortOrder,
      status: lesson.status,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !form.title.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      if (editingId) {
        await updateLesson(accessToken, editingId, {
          title: form.title.trim(),
          videoUrl: form.videoUrl.trim() || undefined,
          summary: form.summary || undefined,
          notes: form.notes || undefined,
          status: form.status,
          publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null,
          sortOrder: form.sortOrder,
        });
      } else {
        await createLesson(accessToken, {
          streamId,
          title: form.title.trim(),
          videoUrl: form.videoUrl.trim() || undefined,
          summary: form.summary || undefined,
          notes: form.notes || undefined,
          publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : undefined,
          sortOrder: form.sortOrder,
        });
      }
      closeForm();
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    if (!confirm('Удалить этот урок? Действие необратимо.')) return;
    setError('');
    try {
      await deleteLesson(accessToken, id);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'admin') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => router.push('/admin/streams')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
          >
            &larr; Назад к потокам
          </button>
          <h1 style={{ margin: 0 }}>
            Уроки{stream ? `: ${stream.name}` : ''}
          </h1>
          {stream?.status === 'archived' && (
            <span style={{ fontSize: 12, color: '#9a3030', background: '#f4e6e6', padding: '2px 8px', borderRadius: 12, fontWeight: 'bold' }}>
              Архивный поток
            </span>
          )}
        </div>
        {stream?.status !== 'archived' && (
          <button
            onClick={showForm ? closeForm : openCreate}
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
            {showForm && !editingId ? 'Отмена' : 'Добавить урок'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00', userSelect: 'text', cursor: 'text' }}>
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 24, padding: 16, background: '#f9f9f9', borderRadius: 8, border: '1px solid #eee' }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Редактировать урок' : 'Новый урок'}</h3>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Название *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Название урока"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Видео URL</label>
            <input
              type="url"
              value={form.videoUrl}
              onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
              placeholder="https://..."
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Краткое описание (Summary)</label>
            <textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="Markdown-текст краткого описания..."
              rows={3}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Конспект (Notes)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Markdown-текст конспекта..."
              rows={5}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Дата публикации</label>
              <input
                type="datetime-local"
                value={form.publishAt}
                onChange={(e) => setForm({ ...form, publishAt: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ width: 120 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Порядок</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            {editingId && (
              <div style={{ width: 160 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Статус</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as LessonFormData['status'] })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
                >
                  <option value="draft">Черновик</option>
                  <option value="published">Опубликован</option>
                  <option value="closed">Закрыт</option>
                </select>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={submitting || !form.title.trim()}
              style={{
                padding: '8px 16px',
                background: submitting ? '#ccc' : '#0070f3',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: submitting ? 'default' : 'pointer',
                fontSize: 14,
              }}
            >
              {submitting ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              style={{ padding: '8px 16px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {loadingLessons ? (
        <p>Загрузка уроков...</p>
      ) : lessons.length === 0 ? (
        <p style={{ color: '#666' }}>Уроков пока нет. Добавьте первый урок.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', width: 50 }}>#</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Название</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Статус</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Публикация</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => (
              <tr key={lesson.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px', color: '#666' }}>{lesson.sortOrder}</td>
                <td style={{ padding: '12px' }}>
                  <div>{lesson.title}</div>
                  {lesson.videoUrl && (
                    <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                      Video: {lesson.videoUrl.length > 40 ? lesson.videoUrl.slice(0, 40) + '...' : lesson.videoUrl}
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 'bold',
                      background: statusColors[lesson.status]?.bg,
                      color: statusColors[lesson.status]?.color,
                    }}
                  >
                    {statusLabels[lesson.status]}
                  </span>
                </td>
                <td style={{ padding: '12px', color: '#666', fontSize: 14 }}>
                  {lesson.publishAt
                    ? new Date(lesson.publishAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
                    : '—'}
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  {stream?.status !== 'archived' && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => openEdit(lesson)}
                        style={{ padding: '4px 12px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Редактировать
                      </button>
                      <button
                        onClick={() => handleDelete(lesson.id)}
                        style={{ padding: '4px 12px', background: '#fee', border: '1px solid #fcc', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#c00' }}
                      >
                        Удалить
                      </button>
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
