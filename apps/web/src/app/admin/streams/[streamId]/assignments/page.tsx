'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner, Button, Badge} from '@platform/ui/atoms';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',      href: '/admin',           icon: <GridIcon /> },
      { label: 'Ученики',    href: '/admin/students',  icon: <UsersIcon /> },
      { label: 'Потоки',     href: '/admin/streams',   icon: <StreamIcon /> },
      { label: 'Расписание', href: '/admin/schedule',  icon: <CalendarIcon /> },
    ],
  },
];
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

const saStatusBadgeVariant: Record<string, 'warning' | 'info' | 'success'> = {
  assigned: 'warning',
  submitted: 'info',
  reviewed: 'success',
};

export default function AssignmentsPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (!user || user.role !== 'admin') return null;

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => { await logout(); router.push('/login'); },
        platformName: 'PLATFORM ADMIN',
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
    <div style={{ padding: 'var(--space-4)', maxWidth: 1000 }}>
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
            Задания{stream ? `: ${stream.name}` : ''}
          </h1>
        </div>
        {stream?.status !== 'archived' && (
          <Button
            variant="primary"
            onClick={showForm ? closeForm : openCreate}
          >
            {showForm && !editingId ? 'Отмена' : 'Добавить задание'}
          </Button>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00', userSelect: 'text', cursor: 'text' }}>
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
                    <Badge variant="default">{typeLabels[a.type]}</Badge>
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
                      <Button
                        variant={viewingId === a.id ? 'primary' : 'ghost'}
                        size="sm"
                        onClick={() => handleView(a.id)}
                      >
                        {viewingId === a.id ? 'Скрыть' : 'Назначения'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { setAssigningId(a.id); setAssignStudentId(''); }}
                      >
                        Назначить
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(a)}
                      >
                        Ред.
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(a.id)}
                      >
                        Удалить
                      </Button>
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
                        <Button
                          variant="primary"
                          disabled={!assignStudentId}
                          onClick={() => assignStudentId && handleAssign(a.id, assignStudentId)}
                        >
                          Назначить ученику
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleAssign(a.id, undefined, streamId)}
                        >
                          Назначить всем
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setAssigningId(null)}
                        >
                          Отмена
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Student assignments detail */}
                {viewingId === a.id && (
                  <tr key={`detail-${a.id}`}>
                    <td colSpan={6} style={{ padding: '12px', background: '#fafafa', borderBottom: '2px solid #eee' }}>
                      {a.description && (
                        <div style={{ marginBottom: 12, padding: 12, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-default)', borderRadius: 4 }}>
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
                                  <Badge variant={saStatusBadgeVariant[sa.status] ?? 'default'}>
                                    {saStatusLabels[sa.status]}
                                  </Badge>
                                </td>
                                <td style={{ padding: '6px 8px', color: '#666' }}>
                                  {sa.submittedAt ? new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', color: '#666' }}>
                                  {sa.reviewedAt ? new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                  {sa.status === 'submitted' && (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => handleReview(sa.id)}
                                    >
                                      Проверено
                                    </Button>
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
    </div>
    </DashboardLayout>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" />
      <rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" />
      <rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" />
      <path d="M15 13c0-2-1-4-3-4" />
    </svg>
  );
}

function StreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h10" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" />
      <path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}
