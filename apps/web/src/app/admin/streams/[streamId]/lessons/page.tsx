'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, Badge } from '@platform/ui/atoms';
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

const statusBadgeVariant: Record<string, 'warning' | 'success' | 'error'> = {
  draft: 'warning',
  published: 'success',
  closed: 'error',
};

export default function LessonsPage() {
  const { user, accessToken } = useAuth();
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

  return (
    <>
    <div style={{ padding: 'var(--spacing-4)', maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/admin/streams')}
            style={{ marginBottom: 8, display: 'block' }}
          >
            ← Назад к потокам
          </Button>
          <h1 style={{ margin: 0 }}>
            Уроки{stream ? `: ${stream.name}` : ''}
          </h1>
          {stream?.status === 'archived' && (
            <Badge variant="error">Архивный поток</Badge>
          )}
        </div>
        {stream?.status !== 'archived' && (
          <Button
            variant="primary"
            onClick={showForm ? closeForm : openCreate}
          >
            {showForm && !editingId ? 'Отмена' : 'Добавить урок'}
          </Button>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: 'var(--color-error-dim)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-xs)', marginBottom: 16, color: 'var(--color-error)', userSelect: 'text', cursor: 'text' }}>
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 24, padding: 16, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-default)' }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Редактировать урок' : 'Новый урок'}</h3>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Название *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Название урока"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
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
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Краткое описание (Summary)</label>
            <textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="Markdown-текст краткого описания..."
              rows={3}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Конспект (Notes)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Markdown-текст конспекта..."
              rows={5}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Дата публикации</label>
              <input
                type="datetime-local"
                value={form.publishAt}
                onChange={(e) => setForm({ ...form, publishAt: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ width: 120 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Порядок</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
              />
            </div>

            {editingId && (
              <div style={{ width: 160 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Статус</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as LessonFormData['status'] })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
                >
                  <option value="draft">Черновик</option>
                  <option value="published">Опубликован</option>
                  <option value="closed">Закрыт</option>
                </select>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              type="submit"
              variant="primary"
              disabled={!form.title.trim()}
              loading={submitting}
            >
              {submitting ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={closeForm}
            >
              Отмена
            </Button>
          </div>
        </form>
      )}

      {loadingLessons ? (
        <p>Загрузка уроков...</p>
      ) : lessons.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)' }}>Уроков пока нет. Добавьте первый урок.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border-default)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', width: 50 }}>#</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Название</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Статус</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Публикация</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => (
              <tr key={lesson.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>{lesson.sortOrder}</td>
                <td style={{ padding: '12px' }}>
                  <div>{lesson.title}</div>
                  {lesson.videoUrl && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                      Video: {lesson.videoUrl.length > 40 ? lesson.videoUrl.slice(0, 40) + '...' : lesson.videoUrl}
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px' }}>
                  <Badge variant={statusBadgeVariant[lesson.status] ?? 'default'}>
                    {statusLabels[lesson.status]}
                  </Badge>
                </td>
                <td style={{ padding: '12px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
                  {lesson.publishAt
                    ? new Date(lesson.publishAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
                    : '—'}
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  {stream?.status !== 'archived' && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(lesson)}
                      >
                        Редактировать
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(lesson.id)}
                      >
                        Удалить
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    </>
  );
}
