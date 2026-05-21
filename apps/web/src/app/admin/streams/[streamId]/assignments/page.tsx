'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  assignAssignment,
  uploadAssignmentMaterial,
  getStreams,
  getLessons,
  getStudents,
  getStudentAssignments,
  updateStudentAssignment,
  type Assignment,
  type AssignmentMaterial,
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

const saStatusBadgeVariant: Record<string, 'secondary' | 'default'> = {
  assigned: 'secondary',
  submitted: 'secondary',
  reviewed: 'default',
};

export default function AssignmentsPage() {
  const { user, accessToken } = useAuth();
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

  // Materials in form
  const [formMaterials, setFormMaterials] = useState<AssignmentMaterial[]>([]);
  const [newUrlName, setNewUrlName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [uploadingMaterial, setUploadingMaterial] = useState(false);

  // Assign modal
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignStudentId, setAssignStudentId] = useState('');

  // Detail view
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [loadingSA, setLoadingSA] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');

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
    setFormMaterials([]);
    setNewUrlName('');
    setNewUrl('');
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
    setFormMaterials(a.materials || []);
    setNewUrlName('');
    setNewUrl('');
    setShowForm(true);
    setViewingId(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormMaterials([]);
    setNewUrlName('');
    setNewUrl('');
  };

  const handleAddUrl = () => {
    const trimmedUrl = newUrl.trim();
    const trimmedName = newUrlName.trim();
    if (!trimmedUrl) return;
    const urlName = trimmedName || trimmedUrl;
    setFormMaterials((prev) => [...prev, { type: 'url', name: urlName, url: trimmedUrl }]);
    setNewUrlName('');
    setNewUrl('');
  };

  const handleUploadFile = async (file: File) => {
    if (!accessToken) return;
    setUploadingMaterial(true);
    setError('');
    try {
      const { material } = await uploadAssignmentMaterial(accessToken, file);
      setFormMaterials((prev) => [...prev, material]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setUploadingMaterial(false);
    }
  };

  const handleRemoveMaterial = (index: number) => {
    setFormMaterials((prev) => prev.filter((_, i) => i !== index));
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
          materials: formMaterials,
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
          materials: formMaterials,
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

  return (
    <>
    <div style={{ padding: 'var(--spacing-4)', maxWidth: 1000 }}>
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
            variant="default"
            onClick={showForm ? closeForm : openCreate}
          >
            {showForm && !editingId ? 'Отмена' : 'Добавить задание'}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" style={{ marginBottom: 16 }}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 24, padding: 16, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-default)' }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Редактировать задание' : 'Новое задание'}</h3>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Название *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Название задания"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
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
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Тип</label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as 'short' | 'long' })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Короткое</SelectItem>
                  <SelectItem value="long">Длинное</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Урок (опционально)</label>
              <Select
                value={form.lessonId || '__none__'}
                onValueChange={(v) => setForm({ ...form, lessonId: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— Без привязки —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Без привязки —</SelectItem>
                  {lessons.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold', fontSize: 14 }}>Дедлайн</label>
              <input
                type="datetime-local"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
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
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)', boxSizing: 'border-box' }}
            />
          </div>

          {/* Материалы */}
          <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--color-bg-overlay)', borderRadius: 'var(--radius-xs)', border: '1px solid var(--color-border-subtle)' }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', fontSize: 14 }}>Материалы</label>

            {/* Existing materials list */}
            {formMaterials.length > 0 && (
              <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {formMaterials.map((m, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: 'var(--color-bg-surface)', padding: '6px 10px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--color-border-default)' }}>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', flexShrink: 0 }}>
                      {m.type === 'file' ? '📎' : '🔗'}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>{m.name}</span>
                    {m.type === 'file' && m.size && (
                      <span style={{ color: 'var(--color-text-disabled)', fontSize: 11, flexShrink: 0 }}>{Math.round(m.size / 1024)}KB</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveMaterial(i)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Add URL */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Добавить ссылку</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={newUrlName}
                  onChange={(e) => setNewUrlName(e.target.value)}
                  placeholder="Название (опционально)"
                  style={{ flex: '0 0 160px', padding: '6px 10px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 13, boxSizing: 'border-box' }}
                />
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddUrl())}
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 13, boxSizing: 'border-box' }}
                />
                <button
                  type="button"
                  onClick={handleAddUrl}
                  disabled={!newUrl.trim()}
                  style={{ padding: '6px 12px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap', opacity: !newUrl.trim() ? 0.5 : 1 }}
                >
                  + Добавить
                </button>
              </div>
            </div>

            {/* Upload file */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Загрузить файл</div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-border-default)', borderRadius: 'var(--radius-xs)', cursor: uploadingMaterial ? 'not-allowed' : 'pointer', fontSize: 13, opacity: uploadingMaterial ? 0.6 : 1 }}>
                {uploadingMaterial ? 'Загрузка...' : '📁 Выбрать файл'}
                <input
                  type="file"
                  style={{ display: 'none' }}
                  disabled={uploadingMaterial}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleUploadFile(file);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              type="submit"
              variant="default"
              disabled={submitting || !form.title.trim()}
            >
              {submitting && <Loader2 className="animate-spin" />}
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
        <p style={{ color: 'var(--color-text-secondary)' }}>Заданий пока нет. Добавьте первое задание.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border-default)' }}>
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
                <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
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
                    <Badge variant="outline">{typeLabels[a.type]}</Badge>
                  </td>
                  <td style={{ padding: '12px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
                    {a.lesson?.title || '—'}
                  </td>
                  <td style={{ padding: '12px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
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
                        variant={viewingId === a.id ? 'default' : 'ghost'}
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
                        variant="destructive"
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
                        <Select
                          value={assignStudentId}
                          onValueChange={setAssignStudentId}
                        >
                          <SelectTrigger style={{ minWidth: 220 }}>
                            <SelectValue placeholder="— Выбрать ученика —" />
                          </SelectTrigger>
                          <SelectContent>
                            {students.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name} ({s.email})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="default"
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
                    <td colSpan={6} style={{ padding: '12px', background: '#fafafa', borderBottom: '2px solid var(--color-border-default)' }}>
                      {a.description && (
                        <div style={{ marginBottom: 12, padding: 12, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-default)', borderRadius: 4 }}>
                          <strong style={{ fontSize: 13 }}>Описание:</strong>
                          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0 0', fontSize: 14 }}>{a.description}</pre>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Назначения:</strong>
                        <Select
                          value={statusFilter || '__all__'}
                          onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : v)}
                        >
                          <SelectTrigger style={{ minWidth: 160 }}>
                            <SelectValue placeholder="Все статусы" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">Все статусы</SelectItem>
                            <SelectItem value="assigned">Назначено</SelectItem>
                            <SelectItem value="submitted">Отправлено</SelectItem>
                            <SelectItem value="reviewed">Проверено</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {loadingSA ? (
                        <p style={{ fontSize: 13 }}>Загрузка...</p>
                      ) : studentAssignments.length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Нет назначений. Используйте «Назначить» для добавления учеников.</p>
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
                              <tr key={sa.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                                <td style={{ padding: '6px 8px' }}>{sa.student?.name || sa.studentId}</td>
                                <td style={{ padding: '6px 8px' }}>
                                  <Badge variant={saStatusBadgeVariant[sa.status] ?? 'default'}>
                                    {saStatusLabels[sa.status]}
                                  </Badge>
                                </td>
                                <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)' }}>
                                  {sa.submittedAt ? new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)' }}>
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
    </>
  );
}
