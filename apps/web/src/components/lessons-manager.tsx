'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2, Plus, Video, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
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

const statusBadgeVariant: Record<string, 'secondary' | 'default' | 'destructive'> = {
  draft: 'secondary',
  published: 'default',
  closed: 'destructive',
};

export function LessonsManager({ streamId }: { streamId: string }) {
  const { user, accessToken } = useAuth();

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
      setLessons([...lessonsData.lessons].sort((a, b) => a.sortOrder - b.sortOrder));
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

  const isArchived = stream?.status === 'archived';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          {stream && (
            <h2 className="text-lg font-semibold tracking-tight">{stream.name}</h2>
          )}
          {isArchived && <Badge variant="destructive">Архивный поток</Badge>}
        </div>
        {!isArchived && (
          <Button
            variant={showForm && !editingId ? 'outline' : 'default'}
            onClick={showForm ? closeForm : openCreate}
          >
            {showForm && !editingId ? (
              'Отмена'
            ) : (
              <>
                <Plus />
                Добавить урок
              </>
            )}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Редактировать урок' : 'Новый урок'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="lesson-title">Название *</FieldLabel>
                  <Input
                    id="lesson-title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Название урока"
                    autoFocus
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="lesson-video">Видео URL</FieldLabel>
                  <Input
                    id="lesson-video"
                    type="url"
                    value={form.videoUrl}
                    onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="lesson-summary">Краткое описание</FieldLabel>
                  <Textarea
                    id="lesson-summary"
                    value={form.summary}
                    onChange={(e) => setForm({ ...form, summary: e.target.value })}
                    placeholder="Краткое описание урока..."
                    rows={3}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="lesson-notes">Конспект</FieldLabel>
                  <Textarea
                    id="lesson-notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Текст конспекта..."
                    rows={5}
                  />
                </Field>

                <div className="flex flex-col gap-4 sm:flex-row">
                  <Field className="flex-1">
                    <FieldLabel htmlFor="lesson-publish">Дата публикации</FieldLabel>
                    <Input
                      id="lesson-publish"
                      type="datetime-local"
                      value={form.publishAt}
                      onChange={(e) => setForm({ ...form, publishAt: e.target.value })}
                    />
                  </Field>

                  <Field className="sm:w-32">
                    <FieldLabel htmlFor="lesson-order">Порядок</FieldLabel>
                    <Input
                      id="lesson-order"
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) =>
                        setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })
                      }
                    />
                  </Field>

                  {editingId && (
                    <Field className="sm:w-44">
                      <FieldLabel htmlFor="lesson-status">Статус</FieldLabel>
                      <Select
                        value={form.status}
                        onValueChange={(v) =>
                          setForm({ ...form, status: v as LessonFormData['status'] })
                        }
                      >
                        <SelectTrigger id="lesson-status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Черновик</SelectItem>
                          <SelectItem value="published">Опубликован</SelectItem>
                          <SelectItem value="closed">Закрыт</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </div>

                <Field orientation="horizontal">
                  <Button type="submit" disabled={submitting || !form.title.trim()}>
                    {submitting && <Loader2 className="animate-spin" />}
                    {submitting ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={closeForm}>
                    Отмена
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">#</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Видео</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Публикация</TableHead>
              <TableHead className="w-[1%] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingLessons ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : lessons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  Уроков пока нет. Добавьте первый урок.
                </TableCell>
              </TableRow>
            ) : (
              lessons.map((lesson) => (
                <TableRow key={lesson.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {lesson.sortOrder}
                  </TableCell>
                  <TableCell className="font-medium">{lesson.title}</TableCell>
                  <TableCell>
                    {lesson.videoUrl ? (
                      <Video className="size-4 text-muted-foreground" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant[lesson.status] ?? 'default'}>
                      {statusLabels[lesson.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {lesson.publishAt
                      ? new Date(lesson.publishAt).toLocaleString('ru-RU', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {!isArchived && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(lesson)}
                        >
                          <Pencil />
                          <span className="sr-only">Редактировать</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(lesson.id)}
                        >
                          <Trash2 />
                          <span className="sr-only">Удалить</span>
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
