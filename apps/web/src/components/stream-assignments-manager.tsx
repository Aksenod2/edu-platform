'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { Loader2, Paperclip, Link2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  getAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  uploadAssignmentMaterial,
  getStreams,
  getLessons,
  getStudentAssignments,
  updateStudentAssignment,
  type Assignment,
  type AssignmentMaterial,
  type Stream,
  type Lesson,
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

export function StreamAssignmentsManager({ streamId }: { streamId: string }) {
  const { user, accessToken } = useAuth();

  const [stream, setStream] = useState<Stream | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [formError, setFormError] = useState('');

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

  // Detail view
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [loadingSA, setLoadingSA] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');

  const fetchData = useCallback(async () => {
    if (!accessToken || !streamId) return;
    setLoadingData(true);
    try {
      const [streamsData, assignmentsData, lessonsData] = await Promise.all([
        getStreams(accessToken),
        getAssignments(accessToken, streamId),
        getLessons(accessToken, streamId),
      ]);
      const found = streamsData.streams.find((s) => s.id === streamId);
      setStream(found || null);
      setAssignments(assignmentsData.assignments);
      setLessons(lessonsData.lessons);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки');
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
    setFormError('');
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
    setFormError('');
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
    setFormError('');
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
    try {
      const { material } = await uploadAssignmentMaterial(accessToken, file);
      setFormMaterials((prev) => [...prev, material]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла');
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
    setFormError('');
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
      toast.success(editingId ? 'Задание обновлено' : 'Задание создано');
      closeForm();
      await fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    try {
      await deleteAssignment(accessToken, id);
      if (viewingId === id) setViewingId(null);
      toast.success('Задание удалено');
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
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
      toast.success('Отмечено как проверено');
      if (viewingId) await loadStudentAssignments(viewingId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  const filteredAssignments = statusFilter
    ? assignments // status filtering is done on student-assignments level, not on assignments
    : assignments;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end">
        {stream?.status !== 'archived' && (
          <Button onClick={showForm ? closeForm : openCreate}>
            {showForm && !editingId ? 'Отмена' : 'Добавить задание'}
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Редактировать задание' : 'Новое задание'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">Название *</Label>
                <Input
                  id="title"
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Название задания"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="description">Описание (Markdown)</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Описание задания в формате Markdown..."
                  rows={5}
                />
              </div>

              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex flex-1 flex-col gap-2">
                  <Label>Тип</Label>
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
                  <p className="text-xs text-muted-foreground">
                    Короткое — ответ в одно поле; длинное — развёрнутая работа с файлами.
                  </p>
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  <Label>Урок (опционально)</Label>
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

                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="dueDate">Дедлайн</Label>
                  <Input
                    id="dueDate"
                    type="datetime-local"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Срок виден студенту; сдачу после него не блокирует.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tags">Теги (через запятую)</Label>
                <Input
                  id="tags"
                  type="text"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="дизайн, верстка, типографика"
                />
              </div>

              {/* Материалы */}
              <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
                <Label>Материалы</Label>

                {/* Existing materials list */}
                {formMaterials.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {formMaterials.map((m, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm"
                      >
                        <span className="shrink-0 text-muted-foreground">
                          {m.type === 'file' ? <Paperclip className="size-4" /> : <Link2 className="size-4" />}
                        </span>
                        <span className="flex-1 truncate text-foreground">{m.name}</span>
                        {m.type === 'file' && m.size && (
                          <span className="shrink-0 text-xs text-muted-foreground">{Math.round(m.size / 1024)}KB</span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveMaterial(i)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add URL */}
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-muted-foreground">Добавить ссылку</div>
                  <div className="flex flex-col gap-1.5 sm:flex-row">
                    <Input
                      type="text"
                      value={newUrlName}
                      onChange={(e) => setNewUrlName(e.target.value)}
                      placeholder="Название (опционально)"
                      className="w-full sm:w-40 sm:shrink-0"
                    />
                    <Input
                      type="url"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder="https://..."
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddUrl())}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleAddUrl}
                      disabled={!newUrl.trim()}
                      className="whitespace-nowrap"
                    >
                      + Добавить
                    </Button>
                  </div>
                </div>

                {/* Upload file */}
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-muted-foreground">Загрузить файл</div>
                  <label
                    className={`inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed bg-card px-3 py-1.5 text-sm ${uploadingMaterial ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    {uploadingMaterial ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Загрузка...
                      </>
                    ) : (
                      <>
                        <Paperclip className="size-4" />
                        Выбрать файл
                      </>
                    )}
                    <input
                      type="file"
                      className="hidden"
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

              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={submitting || !form.title.trim()}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {submitting ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать'}
                </Button>
                <Button type="button" variant="ghost" onClick={closeForm}>
                  Отмена
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loadingData ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Загрузка заданий...
        </div>
      ) : filteredAssignments.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          Заданий пока нет. Добавьте первое задание.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Урок</TableHead>
                <TableHead>Дедлайн</TableHead>
                <TableHead className="text-center">Назначено</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssignments.map((a) => (
                <>
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.title}</div>
                      {a.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="font-normal">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{typeLabels[a.type]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.lesson?.title || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.dueDate
                        ? new Date(a.dueDate).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
                        : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      {a._count?.studentAssignments || 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant={viewingId === a.id ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => handleView(a.id)}
                        >
                          {viewingId === a.id ? 'Скрыть' : 'Назначения'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                          Ред.
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeletingId(a.id)}>
                          Удалить
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Student assignments detail */}
                  {viewingId === a.id && (
                    <TableRow key={`detail-${a.id}`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={6}>
                        {a.description && (
                          <div className="mb-3 rounded-md border bg-card p-3">
                            <strong className="text-sm">Описание:</strong>
                            <pre className="mt-1 mb-0 whitespace-pre-wrap font-sans text-sm">{a.description}</pre>
                          </div>
                        )}
                        <div className="mb-2 flex items-center gap-2">
                          <strong className="text-sm">Назначения:</strong>
                          <Select
                            value={statusFilter || '__all__'}
                            onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : v)}
                          >
                            <SelectTrigger className="min-w-[160px]">
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
                          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Загрузка...
                          </div>
                        ) : studentAssignments.length === 0 ? (
                          <p className="py-2 text-sm text-muted-foreground">
                            Нет назначений. Задание выдаётся автоматически всем зачисленным студентам потока.
                          </p>
                        ) : (
                          <div className="rounded-lg border bg-card">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Ученик</TableHead>
                                  <TableHead>Статус</TableHead>
                                  <TableHead>Отправлено</TableHead>
                                  <TableHead>Проверено</TableHead>
                                  <TableHead className="text-right">Действие</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(statusFilter
                                  ? studentAssignments.filter((sa) => sa.status === statusFilter)
                                  : studentAssignments
                                ).map((sa) => (
                                  <TableRow key={sa.id}>
                                    <TableCell>{sa.student?.name || sa.studentId}</TableCell>
                                    <TableCell>
                                      <Badge variant={saStatusBadgeVariant[sa.status] ?? 'default'}>
                                        {saStatusLabels[sa.status]}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {sa.submittedAt ? new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {sa.reviewedAt ? new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {sa.status === 'submitted' && (
                                        <Button variant="secondary" size="sm" onClick={() => handleReview(sa.id)}>
                                          Проверено
                                        </Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить задание?</AlertDialogTitle>
            <AlertDialogDescription>
              Все назначения этого задания будут удалены. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deletingId) handleDelete(deletingId);
                setDeletingId(null);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
