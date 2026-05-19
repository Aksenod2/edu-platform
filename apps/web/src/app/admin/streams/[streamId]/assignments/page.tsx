'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  assignAssignment,
  getStreams,
  getLessons,
  getStudents,
  getStudentAssignments,
  updateStudentAssignment,
  type Assignment,
  type Stream,
  type Lesson,
  type Student,
  type StudentAssignment,
} from '@/lib/api';

type AssignmentFormData = {
  title: string;
  description: string;
  type: 'short' | 'long';
  tags: string;
  dueDate: string;
  lessonId: string;
};

const emptyForm: AssignmentFormData = {
  title: '',
  description: '',
  type: 'short',
  tags: '',
  dueDate: '',
  lessonId: '',
};

const typeLabels: Record<string, string> = {
  short: 'Короткое',
  long: 'Длинное',
};

const saStatusLabels: Record<string, string> = {
  assigned: 'Назначено',
  submitted: 'Отправлено',
  reviewed: 'Проверено',
};

const saStatusColors: Record<string, { bg: string; color: string }> = {
  assigned: { bg: '#fff3cd', color: '#856404' },
  submitted: { bg: '#cce5ff', color: '#004085' },
  reviewed: { bg: '#e6f4ea', color: '#1a7f37' },
};

export default function AssignmentsPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const streamId = params.streamId as string;

  const [stream, setStream] = useState<Stream | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');

  // Create / edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AssignmentFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // Assign modal
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignStudentId, setAssignStudentId] = useState('');

  // Detail view
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [loadingSA, setLoadingSA] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchData = useCallback(async () => {
    if (!accessToken || !streamId) return;
    setLoadingData(true);
    try {
      const [streamsData, assignmentsData, lessonsData, studentsData] = await Promise.all([
        getStreams(accessToken),
        getAssignments(accessToken, streamId),
        getLessons(accessToken, streamId),
        getStudents(accessToken),
      ]);
      const found = streamsData.streams.find((s) => s.id === streamId);
      setStream(found || null);
      setAssignments(assignmentsData.assignments);
      setLessons(lessonsData.lessons);
      setStudents(studentsData.users.filter((u) => u.role === 'student'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
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
    setViewingId(null);
  };

  const openEdit = (a: Assignment) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      description: a.description || '',
      type: a.type,
      tags: a.tags.join(', '),
      dueDate: a.dueDate ? a.dueDate.slice(0, 16) : '',
      lessonId: a.lessonId || '',
    });
    setShowForm(true);
    setViewingId(null);
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
      const tags = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (editingId) {
        await updateAssignment(accessToken, editingId, {
          title: form.title.trim(),
          description: form.description || undefined,
          type: form.type,
          tags,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
          lessonId: form.lessonId || null,
        });
      } else {
        await createAssignment(accessToken, {
          streamId,
          title: form.title.trim(),
          description: form.description || undefined,
          type: form.type,
          tags,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
          lessonId: form.lessonId || undefined,
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
    if (!confirm('Удалить это задание? Все назначения будут удалены.')) return;
    setError('');
    try {
      await deleteAssignment(accessToken, id);
      if (viewingId === id) setViewingId(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  const handleAssign = async (assignmentId: string, studentId?: string, groupId?: string) => {
    if (!accessToken) return;
    setError('');
    try {
      await assignAssignment(accessToken, assignmentId, { studentId, groupId });
      setAssigningId(null);
      setAssignStudentId('');
      await fetchData();
      if (viewingId === assignmentId) {
        await loadStudentAssignments(assignmentId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка назначения');
    }
  };

  const loadStudentAssignments = useCallback(async (assignmentId: string) => {
    if (!accessToken) return;
    setLoadingSA(true);
    try {
      const data = await getStudentAssignments(accessToken, { streamId });
      setStudentAssignments(data.studentAssignments.filter((sa) => sa.assignmentId === assignmentId));
    } catch {
      setStudentAssignments([]);
    } finally {
      setLoadingSA(false);
    }
  }, [accessToken, streamId]);

  const handleView = async (assignmentId: string) => {
    if (viewingId === assignmentId) {
      setViewingId(null);
      return;
    }
    setViewingId(assignmentId);
    setShowForm(false);
    await loadStudentAssignments(assignmentId);
  };

  const handleReview = async (saId: string) => {
    if (!accessToken) return;
    try {
      await updateStudentAssignment(accessToken, saId, { status: 'reviewed' });
      if (viewingId) await loadStudentAssignments(viewingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  const filteredAssignments = statusFilter
    ? assignments // status filtering is done on student-assignments level, not on assignments
    : assignments;

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'admin') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => router.push('/admin/streams')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
          >
            &larr; Назад к потокам
          </button>
          <h1 style={{ margin: 0 }}>
            Задания{stream ? `: ${stream.name}` : ''}
          </h1>
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
            {showForm && !editingId ? 'Отмена' : 'Добавить задание'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00' }}>
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 24, padding: 16, background: '#f9f9f9', borderRadius: 8, border: '1px solid #eee' }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Редактировать задание' : 'Новое задание'}</h3>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Название *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Название задания"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Описание (Markdown)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Описание задания в формате Markdown..."
              rows={5}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Тип</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as 'short' | 'long' })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              >
                <option value="short">Короткое</option>
                <option value="long">Длинное</option>
              </select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Урок (опционально)</label>
              <select
                value={form.lessonId}
                onChange={(e) => setForm({ ...form, lessonId: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              >
                <option value="">— Без привязки —</option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>{l.title}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Дедлайн</label>
              <input
                type="datetime-local"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Теги (через запятую)</label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="дизайн, верстка, типографика"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
            />
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

      {loadingData ? (
        <p>Загрузка заданий...</p>
      ) : filteredAssignments.length === 0 ? (
        <p style={{ color: '#666' }}>Заданий пока нет. Добавьте первое задание.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Название</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Тип</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Урок</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Дедлайн</th>
              <th style={{ textAlign: 'center', padding: '8px 12px' }}>Назначено</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssignments.map((a) => (
              <>
                <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '12px' }}>
                    <div style={{ fontWeight: 500 }}>{a.title}</div>
                    {a.tags.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {a.tags.map((tag) => (
                          <span key={tag} style={{ fontSize: 11, background: '#e8e8e8', padding: '1px 6px', borderRadius: 8 }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ fontSize: 12, background: a.type === 'long' ? '#e8d5f5' : '#d5e8f5', padding: '2px 8px', borderRadius: 12 }}>
                      {typeLabels[a.type]}
                    </span>
                  </td>
                  <td style={{ padding: '12px', color: '#666', fontSize: 14 }}>
                    {a.lesson?.title || '—'}
                  </td>
                  <td style={{ padding: '12px', color: '#666', fontSize: 14 }}>
                    {a.dueDate
                      ? new Date(a.dueDate).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    {a._count?.studentAssignments || 0}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleView(a.id)}
                        style={{ padding: '4px 10px', background: viewingId === a.id ? '#0070f3' : '#eee', color: viewingId === a.id ? '#fff' : '#333', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        {viewingId === a.id ? 'Скрыть' : 'Назначения'}
                      </button>
                      <button
                        onClick={() => { setAssigningId(a.id); setAssignStudentId(''); }}
                        style={{ padding: '4px 10px', background: '#e6f4ea', border: '1px solid #a3d9a5', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#1a7f37' }}
                      >
                        Назначить
                      </button>
                      <button
                        onClick={() => openEdit(a)}
                        style={{ padding: '4px 10px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                      >
                        Ред.
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        style={{ padding: '4px 10px', background: '#fee', border: '1px solid #fcc', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#c00' }}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Assign modal inline */}
                {assigningId === a.id && (
                  <tr key={`assign-${a.id}`}>
                    <td colSpan={6} style={{ padding: '12px 12px 16px', background: '#f0f8ff', borderBottom: '1px solid #cce5ff' }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={assignStudentId}
                          onChange={(e) => setAssignStudentId(e.target.value)}
                          style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
                        >
                          <option value="">— Выбрать ученика —</option>
                          {students.map((s) => (
                            <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                          ))}
                        </select>
                        <button
                          onClick={() => assignStudentId && handleAssign(a.id, assignStudentId)}
                          disabled={!assignStudentId}
                          style={{ padding: '6px 12px', background: assignStudentId ? '#0070f3' : '#ccc', color: '#fff', border: 'none', borderRadius: 4, cursor: assignStudentId ? 'pointer' : 'default', fontSize: 13 }}
                        >
                          Назначить ученику
                        </button>
                        <button
                          onClick={() => handleAssign(a.id, undefined, streamId)}
                          style={{ padding: '6px 12px', background: '#1a7f37', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                        >
                          Назначить всем
                        </button>
                        <button
                          onClick={() => setAssigningId(null)}
                          style={{ padding: '6px 12px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                        >
                          Отмена
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Student assignments detail */}
                {viewingId === a.id && (
                  <tr key={`detail-${a.id}`}>
                    <td colSpan={6} style={{ padding: '12px', background: '#fafafa', borderBottom: '2px solid #eee' }}>
                      {a.description && (
                        <div style={{ marginBottom: 12, padding: 12, background: '#fff', border: '1px solid #eee', borderRadius: 4 }}>
                          <strong style={{ fontSize: 13 }}>Описание:</strong>
                          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0 0', fontSize: 14 }}>{a.description}</pre>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Назначения:</strong>
                        <select
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                          style={{ padding: '2px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 12 }}
                        >
                          <option value="">Все статусы</option>
                          <option value="assigned">Назначено</option>
                          <option value="submitted">Отправлено</option>
                          <option value="reviewed">Проверено</option>
                        </select>
                      </div>
                      {loadingSA ? (
                        <p style={{ fontSize: 13 }}>Загрузка...</p>
                      ) : studentAssignments.length === 0 ? (
                        <p style={{ fontSize: 13, color: '#666' }}>Нет назначений. Используйте «Назначить» для добавления учеников.</p>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #ddd' }}>
                              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Ученик</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Статус</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Отправлено</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Проверено</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Действие</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(statusFilter
                              ? studentAssignments.filter((sa) => sa.status === statusFilter)
                              : studentAssignments
                            ).map((sa) => (
                              <tr key={sa.id} style={{ borderBottom: '1px solid #eee' }}>
                                <td style={{ padding: '6px 8px' }}>{sa.student?.name || sa.studentId}</td>
                                <td style={{ padding: '6px 8px' }}>
                                  <span style={{
                                    padding: '1px 6px',
                                    borderRadius: 10,
                                    fontSize: 11,
                                    fontWeight: 'bold',
                                    background: saStatusColors[sa.status]?.bg,
                                    color: saStatusColors[sa.status]?.color,
                                  }}>
                                    {saStatusLabels[sa.status]}
                                  </span>
                                </td>
                                <td style={{ padding: '6px 8px', color: '#666' }}>
                                  {sa.submittedAt ? new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', color: '#666' }}>
                                  {sa.reviewedAt ? new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                  {sa.status === 'submitted' && (
                                    <button
                                      onClick={() => handleReview(sa.id)}
                                      style={{ padding: '2px 8px', background: '#e6f4ea', border: '1px solid #a3d9a5', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#1a7f37' }}
                                    >
                                      Проверено
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
