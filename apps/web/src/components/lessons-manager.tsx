'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { Loader2, Plus, Video, Pencil, Trash2, FileText, Paperclip, X, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field';
import { DateTimePicker } from '@/components/datetime-picker';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  uploadLessonMaterial,
  deleteLessonMaterial,
  uploadLessonVideo,
  deleteLessonVideo,
  getStreams,
  getTeachers,
  type Lesson,
  type LessonMaterial,
  type Stream,
  type Teacher,
} from '@/lib/api';

type LessonFormData = {
  title: string;
  videoUrl: string;
  summary: string;
  notes: string;
  publishAt: string;
  scheduledAt: string;
  sortOrder: number;
  status: 'draft' | 'published' | 'closed';
  teacherIds: string[];
};

const emptyForm: LessonFormData = {
  title: '',
  videoUrl: '',
  summary: '',
  notes: '',
  publishAt: '',
  scheduledAt: '',
  sortOrder: 0,
  status: 'draft',
  teacherIds: [],
};

function lessonToForm(lesson: Lesson): LessonFormData {
  return {
    title: lesson.title,
    videoUrl: lesson.videoUrl || '',
    summary: lesson.summary || '',
    notes: lesson.notes || '',
    publishAt: lesson.publishAt ? lesson.publishAt.slice(0, 16) : '',
    scheduledAt: lesson.scheduledAt ? lesson.scheduledAt.slice(0, 16) : '',
    sortOrder: lesson.sortOrder,
    status: lesson.status,
    teacherIds: (lesson.teachers ?? []).map((t) => t.id),
  };
}

// Инициалы из имени для аватара преподавателя
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// Чек-лист выбора преподавателей (admins) для урока
function TeacherPicker({
  teachers,
  selected,
  onToggle,
}: {
  teachers: Teacher[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (teachers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Нет доступных преподавателей.
      </p>
    );
  }
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border">
      <ul className="divide-y">
        {teachers.map((teacher) => (
          <li key={teacher.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
              <Checkbox
                checked={selected.includes(teacher.id)}
                onCheckedChange={() => onToggle(teacher.id)}
              />
              <Avatar size="sm">
                <AvatarFallback>{initials(teacher.name)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{teacher.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {teacher.email}
                </span>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Ряд аватаров преподавателей урока с инициалами
function TeacherAvatars({ teachers }: { teachers?: { id: string; name: string }[] }) {
  if (!teachers || teachers.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex -space-x-2">
      {teachers.map((t) => (
        <Avatar key={t.id} size="sm" className="ring-2 ring-background" title={t.name}>
          <AvatarFallback>{initials(t.name)}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  );
}

// Человекочитаемый размер файла материала
function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// Секция «Материалы (PDF/MD)» для существующего урока: загрузка, список,
// удаление (через AlertDialog). Доступна только когда урок уже создан (есть id).
function LessonMaterialsSection({
  lessonId,
  materials,
  onChange,
}: {
  lessonId: string;
  materials: LessonMaterial[];
  onChange: (materials: LessonMaterial[]) => void;
}) {
  const { accessToken } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<LessonMaterial | null>(null);

  const handleUpload = async (file: File) => {
    if (!accessToken) return;
    // Проверка формата на фронте (строго PDF/MD). Главная валидация — на бэке.
    const name = file.name.toLowerCase();
    const okExt = name.endsWith('.pdf') || name.endsWith('.md') || name.endsWith('.markdown');
    if (!okExt) {
      toast.error('Поддерживаются только PDF и MD');
      return;
    }
    setUploading(true);
    try {
      const { materials: updated } = await uploadLessonMaterial(accessToken, lessonId, file);
      onChange(updated);
      toast.success('Материал добавлен');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (material: LessonMaterial) => {
    if (!accessToken) return;
    try {
      const { materials: updated } = await deleteLessonMaterial(
        accessToken,
        lessonId,
        material.s3Key,
      );
      onChange(updated);
      toast.success('Материал удалён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
      <FieldLabel>Материалы (PDF/MD)</FieldLabel>

      {materials.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {materials.map((m) => (
            <div
              key={m.s3Key}
              className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              {m.url ? (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-foreground underline underline-offset-4"
                >
                  {m.fileName}
                </a>
              ) : (
                <span className="flex-1 truncate text-foreground">{m.fileName}</span>
              )}
              {m.size ? (
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(m.size)}</span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-destructive hover:text-destructive"
                onClick={() => setToDelete(m)}
              >
                <X className="size-4" />
                <span className="sr-only">Удалить материал</span>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Материалы не добавлены.</p>
      )}

      <div className="flex flex-col gap-1">
        <div className="text-xs text-muted-foreground">Загрузить файл (PDF или MD)</div>
        <label
          className={`inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed bg-card px-3 py-1.5 text-sm ${uploading ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {uploading ? (
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
            accept=".pdf,.md,.markdown,application/pdf,text/markdown"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleUpload(file);
                e.target.value = '';
              }
            }}
          />
        </label>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => { if (!open) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить материал?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `Файл «${toDelete.fileName}» будет удалён из урока. Действие необратимо.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => { if (toDelete) handleDelete(toDelete); }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Допустимые расширения видео (валидация дублируется на бэке).
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v'];

// Секция «Видеозапись урока»: ОДИН файл (в отличие от материалов). Можно
// загрузить/заменить/удалить видео. Внешняя ссылка videoUrl — отдельное поле
// формы рядом, как альтернатива загрузке.
function LessonVideoSection({
  lessonId,
  hasVideo,
  onChange,
}: {
  lessonId: string;
  hasVideo: boolean;
  onChange: (lesson: Lesson) => void;
}) {
  const { accessToken } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleUpload = async (file: File) => {
    if (!accessToken) return;
    // Проверка формата на фронте. Главная валидация — на бэке.
    const name = file.name.toLowerCase();
    const okExt = VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
    if (!okExt) {
      toast.error('Поддерживаются видеофайлы (MP4)');
      return;
    }
    setUploading(true);
    try {
      const { lesson } = await uploadLessonVideo(accessToken, lessonId, file);
      onChange(lesson);
      toast.success(hasVideo ? 'Видео заменено' : 'Видео загружено');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки видео');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!accessToken) return;
    try {
      const { lesson } = await deleteLessonVideo(accessToken, lessonId);
      onChange(lesson);
      toast.success('Видео удалено');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
      <FieldLabel>Видеозапись урока</FieldLabel>

      {hasVideo ? (
        <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm">
          <Film className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-foreground">Видео загружено</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <X className="size-4" />
            <span className="sr-only">Удалить видео</span>
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Видео не загружено.</p>
      )}

      <div className="flex flex-col gap-1">
        <div className="text-xs text-muted-foreground">
          {hasVideo ? 'Заменить видеофайл (MP4/WebM/MOV)' : 'Загрузить видеофайл (MP4/WebM/MOV)'}
        </div>
        <label
          className={`inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed bg-card px-3 py-1.5 text-sm ${uploading ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Загрузка...
            </>
          ) : (
            <>
              <Paperclip className="size-4" />
              {hasVideo ? 'Заменить файл' : 'Выбрать файл'}
            </>
          )}
          <input
            type="file"
            accept="video/mp4,video/webm,.mp4,.webm,.mov,.m4v"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleUpload(file);
                e.target.value = '';
              }
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Большие файлы пока ограничены лимитом сервера — загружайте небольшие записи.
        </p>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить видео?</AlertDialogTitle>
            <AlertDialogDescription>
              Загруженная видеозапись будет удалена из урока. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => handleDelete()}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [error, setError] = useState('');

  // Create form (separate inline affordance)
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<LessonFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // Row-view Sheet (view-first, then in-place edit — Variant A)
  const [viewLesson, setViewLesson] = useState<Lesson | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<LessonFormData>(emptyForm);
  const [savingEdit, setSavingEdit] = useState(false);

  // Подтверждение удаления урока
  const [lessonToDelete, setLessonToDelete] = useState<Lesson | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken || !streamId) return;
    setLoadingLessons(true);
    try {
      const [streamsData, lessonsData, teachersData] = await Promise.all([
        getStreams(accessToken),
        getLessons(accessToken, streamId, { mine: mineOnly }),
        getTeachers(accessToken),
      ]);
      const found = streamsData.streams.find((s) => s.id === streamId);
      setStream(found || null);
      setLessons([...lessonsData.lessons].sort((a, b) => a.sortOrder - b.sortOrder));
      setTeachers(teachersData.teachers);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingLessons(false);
    }
  }, [accessToken, streamId, mineOnly]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchData();
    }
  }, [accessToken, user, fetchData]);

  const openCreate = () => {
    setForm(emptyForm);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm);
  };

  // --- Row view / in-place edit ---
  const openView = (lesson: Lesson) => {
    setViewLesson(lesson);
    setEditing(false);
    setSheetOpen(true);
  };

  const startEdit = () => {
    if (!viewLesson) return;
    setEditForm(lessonToForm(viewLesson));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleSheetOpenChange = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setEditing(false);
      setViewLesson(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !form.title.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await createLesson(accessToken, {
        streamId,
        title: form.title.trim(),
        videoUrl: form.videoUrl.trim() || undefined,
        summary: form.summary || undefined,
        notes: form.notes || undefined,
        publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : undefined,
        // Наивная локальная строка "YYYY-MM-DDTHH:MM" — без перевода в ISO/UTC
        scheduledAt: form.scheduledAt ? form.scheduledAt : undefined,
        sortOrder: form.sortOrder,
        teacherIds: form.teacherIds,
      });
      closeForm();
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !viewLesson || !editForm.title.trim()) return;
    setSavingEdit(true);
    setError('');
    try {
      const { lesson } = await updateLesson(accessToken, viewLesson.id, {
        title: editForm.title.trim(),
        videoUrl: editForm.videoUrl.trim() || undefined,
        summary: editForm.summary || undefined,
        notes: editForm.notes || undefined,
        status: editForm.status,
        publishAt: editForm.publishAt ? new Date(editForm.publishAt).toISOString() : null,
        // Наивная локальная строка "YYYY-MM-DDTHH:MM"; null — чтобы можно было очистить
        scheduledAt: editForm.scheduledAt ? editForm.scheduledAt : null,
        sortOrder: editForm.sortOrder,
        teacherIds: editForm.teacherIds,
      });
      setViewLesson(lesson);
      setEditing(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSavingEdit(false);
    }
  };

  // Обновляет материалы открытого урока в локальном состоянии (после загрузки/удаления)
  // и синхронизирует строку в таблице, чтобы не делать полный рефетч.
  const handleMaterialsChange = (lessonId: string, materials: LessonMaterial[]) => {
    setViewLesson((prev) => (prev && prev.id === lessonId ? { ...prev, materials } : prev));
    setLessons((prev) =>
      prev.map((l) => (l.id === lessonId ? { ...l, materials } : l)),
    );
  };

  // Заменяет урок целиком после загрузки/удаления видео (бэк возвращает
  // обновлённый урок с videoKey/videoFileUrl). Синхронизирует строку таблицы.
  const handleVideoChange = (updated: Lesson) => {
    setViewLesson((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    setLessons((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    setError('');
    try {
      await deleteLesson(accessToken, id);
      if (viewLesson?.id === id) handleSheetOpenChange(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  const toggleFormTeacher = (id: string) =>
    setForm((prev) => ({
      ...prev,
      teacherIds: prev.teacherIds.includes(id)
        ? prev.teacherIds.filter((t) => t !== id)
        : [...prev.teacherIds, id],
    }));

  const toggleEditTeacher = (id: string) =>
    setEditForm((prev) => ({
      ...prev,
      teacherIds: prev.teacherIds.includes(id)
        ? prev.teacherIds.filter((t) => t !== id)
        : [...prev.teacherIds, id],
    }));

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
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm whitespace-nowrap">
            <Checkbox
              checked={mineOnly}
              onCheckedChange={(v) => setMineOnly(v === true)}
            />
            Только мои
          </label>
          {!isArchived && (
            <Button
              variant={showForm ? 'outline' : 'default'}
              onClick={showForm ? closeForm : openCreate}
            >
              {showForm ? (
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
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Новый урок</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate}>
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
                  <FieldLabel htmlFor="lesson-video">Видео URL (внешняя ссылка)</FieldLabel>
                  <Input
                    id="lesson-video"
                    type="url"
                    value={form.videoUrl}
                    onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                    placeholder="https://..."
                  />
                  <FieldDescription>
                    Ссылка на YouTube/Vimeo и т.п. Чтобы загрузить видеофайл, сначала
                    сохраните урок, затем откройте его.
                  </FieldDescription>
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
                  <FieldDescription>
                    Видно студенту в «Материалах» — короткий анонс урока.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="lesson-notes">Заметки преподавателя</FieldLabel>
                  <Textarea
                    id="lesson-notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Заметки для преподавателей..."
                    rows={5}
                  />
                  <FieldDescription>
                    Видны только преподавателям, студенту не показываются.
                  </FieldDescription>
                </Field>

                <div className="flex flex-col gap-4 sm:flex-row">
                  <Field className="flex-1">
                    <FieldLabel htmlFor="lesson-publish">Дата публикации</FieldLabel>
                    <DateTimePicker
                      id="lesson-publish"
                      value={form.publishAt}
                      onChange={(v) => setForm({ ...form, publishAt: v })}
                    />
                    <FieldDescription>
                      Когда черновик автоматически станет опубликованным.
                    </FieldDescription>
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
                    <FieldDescription>Порядок урока в списке потока.</FieldDescription>
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="lesson-scheduled">Дата и время занятия</FieldLabel>
                  <DateTimePicker
                    id="lesson-scheduled"
                    value={form.scheduledAt}
                    onChange={(v) => setForm({ ...form, scheduledAt: v })}
                  />
                  <FieldDescription>
                    Появится в расписании и календаре.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel>Преподаватели</FieldLabel>
                  <TeacherPicker
                    teachers={teachers}
                    selected={form.teacherIds}
                    onToggle={toggleFormTeacher}
                  />
                </Field>

                <Field>
                  <FieldLabel>Материалы (PDF/MD)</FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Сначала сохраните урок, затем откройте его и добавьте материалы.
                  </p>
                </Field>

                <Field orientation="horizontal">
                  <Button type="submit" disabled={submitting || !form.title.trim()}>
                    {submitting && <Loader2 className="animate-spin" />}
                    {submitting ? 'Сохранение...' : 'Создать'}
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
              <TableHead>Преподаватели</TableHead>
              <TableHead>Видео</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Публикация</TableHead>
              <TableHead className="w-[1%] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingLessons ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : lessons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Уроков пока нет. Добавьте первый урок.
                </TableCell>
              </TableRow>
            ) : (
              lessons.map((lesson) => (
                <TableRow
                  key={lesson.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openView(lesson)}
                >
                  <TableCell className="tabular-nums text-muted-foreground">
                    {lesson.sortOrder}
                  </TableCell>
                  <TableCell className="font-medium">{lesson.title}</TableCell>
                  <TableCell>
                    <TeacherAvatars teachers={lesson.teachers} />
                  </TableCell>
                  <TableCell>
                    {lesson.videoFileUrl ? (
                      <Film className="size-4 text-muted-foreground" />
                    ) : lesson.videoUrl ? (
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
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLessonToDelete(lesson);
                          }}
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

      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          {viewLesson && (
            <>
              <SheetHeader>
                <SheetTitle>{editing ? 'Редактировать урок' : viewLesson.title}</SheetTitle>
              </SheetHeader>

              {editing ? (
                <form
                  onSubmit={handleSaveEdit}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <div className="flex-1 overflow-y-auto px-4 pb-4">
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="edit-title">Название *</FieldLabel>
                        <Input
                          id="edit-title"
                          value={editForm.title}
                          onChange={(e) =>
                            setEditForm({ ...editForm, title: e.target.value })
                          }
                          placeholder="Название урока"
                          autoFocus
                        />
                      </Field>

                      <Field>
                        <LessonVideoSection
                          lessonId={viewLesson.id}
                          hasVideo={!!viewLesson.videoFileUrl}
                          onChange={handleVideoChange}
                        />
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="edit-video">Видео URL (внешняя ссылка)</FieldLabel>
                        <Input
                          id="edit-video"
                          type="url"
                          value={editForm.videoUrl}
                          onChange={(e) =>
                            setEditForm({ ...editForm, videoUrl: e.target.value })
                          }
                          placeholder="https://..."
                        />
                        <FieldDescription>
                          Альтернатива загрузке: ссылка на YouTube/Vimeo или другой источник.
                          Если загружен файл, для студента используется он.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="edit-summary">Краткое описание</FieldLabel>
                        <Textarea
                          id="edit-summary"
                          value={editForm.summary}
                          onChange={(e) =>
                            setEditForm({ ...editForm, summary: e.target.value })
                          }
                          placeholder="Краткое описание урока..."
                          rows={3}
                        />
                        <FieldDescription>
                          Видно студенту в «Материалах» — короткий анонс урока.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="edit-notes">Заметки преподавателя</FieldLabel>
                        <Textarea
                          id="edit-notes"
                          value={editForm.notes}
                          onChange={(e) =>
                            setEditForm({ ...editForm, notes: e.target.value })
                          }
                          placeholder="Заметки для преподавателей..."
                          rows={5}
                        />
                        <FieldDescription>
                          Видны только преподавателям, студенту не показываются.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="edit-status">Статус</FieldLabel>
                        <Select
                          value={editForm.status}
                          onValueChange={(v) =>
                            setEditForm({
                              ...editForm,
                              status: v as LessonFormData['status'],
                            })
                          }
                        >
                          <SelectTrigger id="edit-status" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Черновик</SelectItem>
                            <SelectItem value="published">Опубликован</SelectItem>
                            <SelectItem value="closed">Закрыт</SelectItem>
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          Черновик не виден студентам; опубликован — доступен в уроках и материалах.
                        </FieldDescription>
                      </Field>

                      <div className="flex flex-col gap-4 sm:flex-row">
                        <Field className="flex-1">
                          <FieldLabel htmlFor="edit-publish">Дата публикации</FieldLabel>
                          <DateTimePicker
                            id="edit-publish"
                            value={editForm.publishAt}
                            onChange={(v) =>
                              setEditForm({ ...editForm, publishAt: v })
                            }
                          />
                          <FieldDescription>
                            Когда черновик автоматически станет опубликованным.
                          </FieldDescription>
                        </Field>

                        <Field className="sm:w-28">
                          <FieldLabel htmlFor="edit-order">Порядок</FieldLabel>
                          <Input
                            id="edit-order"
                            type="number"
                            value={editForm.sortOrder}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                sortOrder: parseInt(e.target.value) || 0,
                              })
                            }
                          />
                          <FieldDescription>Порядок урока в списке потока.</FieldDescription>
                        </Field>
                      </div>

                      <Field>
                        <FieldLabel htmlFor="edit-scheduled">Дата и время занятия</FieldLabel>
                        <DateTimePicker
                          id="edit-scheduled"
                          value={editForm.scheduledAt}
                          onChange={(v) =>
                            setEditForm({ ...editForm, scheduledAt: v })
                          }
                        />
                        <FieldDescription>
                          Появится в расписании и календаре.
                        </FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel>Преподаватели</FieldLabel>
                        <TeacherPicker
                          teachers={teachers}
                          selected={editForm.teacherIds}
                          onToggle={toggleEditTeacher}
                        />
                      </Field>

                      <Field>
                        <LessonMaterialsSection
                          lessonId={viewLesson.id}
                          materials={viewLesson.materials ?? []}
                          onChange={(m) => handleMaterialsChange(viewLesson.id, m)}
                        />
                      </Field>
                    </FieldGroup>
                  </div>

                  <SheetFooter className="flex-row">
                    <Button type="submit" disabled={savingEdit || !editForm.title.trim()}>
                      {savingEdit && <Loader2 className="animate-spin" />}
                      {savingEdit ? 'Сохранение...' : 'Сохранить'}
                    </Button>
                    <Button type="button" variant="ghost" onClick={cancelEdit}>
                      Отмена
                    </Button>
                  </SheetFooter>
                </form>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto px-4 pb-4">
                    <dl className="flex flex-col gap-5 text-sm">
                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Статус</dt>
                        <dd>
                          <Badge
                            variant={statusBadgeVariant[viewLesson.status] ?? 'default'}
                          >
                            {statusLabels[viewLesson.status]}
                          </Badge>
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Преподаватели</dt>
                        <dd>
                          {viewLesson.teachers && viewLesson.teachers.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {viewLesson.teachers.map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-flex items-center gap-2"
                                >
                                  <Avatar size="sm">
                                    <AvatarFallback>{initials(t.name)}</AvatarFallback>
                                  </Avatar>
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Видеозапись (загруженный файл)</dt>
                        <dd>
                          {viewLesson.videoFileUrl ? (
                            <span className="inline-flex items-center gap-1.5 text-foreground">
                              <Film className="size-4 shrink-0 text-muted-foreground" />
                              Видео загружено
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Видео URL (внешняя ссылка)</dt>
                        <dd>
                          {viewLesson.videoUrl ? (
                            <a
                              href={viewLesson.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-primary underline underline-offset-4 break-all"
                            >
                              <Video className="size-4 shrink-0" />
                              {viewLesson.videoUrl}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Краткое описание</dt>
                        <dd>
                          {viewLesson.summary ? (
                            <span className="whitespace-pre-wrap">{viewLesson.summary}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Заметки преподавателя</dt>
                        <dd>
                          {viewLesson.notes ? (
                            <span className="whitespace-pre-wrap">{viewLesson.notes}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Материалы (PDF/MD)</dt>
                        <dd>
                          {viewLesson.materials && viewLesson.materials.length > 0 ? (
                            <div className="flex flex-col gap-1.5">
                              {viewLesson.materials.map((m) => (
                                <a
                                  key={m.s3Key}
                                  href={m.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-primary underline underline-offset-4 break-all"
                                >
                                  <FileText className="size-4 shrink-0" />
                                  {m.fileName}
                                  {m.size ? (
                                    <span className="text-xs text-muted-foreground">
                                      {formatSize(m.size)}
                                    </span>
                                  ) : null}
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Дата публикации</dt>
                        <dd className="tabular-nums">
                          {viewLesson.publishAt
                            ? new Date(viewLesson.publishAt).toLocaleString('ru-RU', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : '—'}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Дата занятия</dt>
                        <dd className="tabular-nums">
                          {viewLesson.scheduledAt
                            ? new Date(viewLesson.scheduledAt).toLocaleString('ru-RU', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : '—'}
                        </dd>
                      </div>

                      <div className="flex flex-col gap-1">
                        <dt className="text-muted-foreground">Порядок</dt>
                        <dd className="tabular-nums">{viewLesson.sortOrder}</dd>
                      </div>
                    </dl>
                  </div>

                  {!isArchived && (
                    <SheetFooter className="flex-row">
                      <Button onClick={startEdit}>
                        <Pencil />
                        Редактировать
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setLessonToDelete(viewLesson)}
                      >
                        <Trash2 />
                        Удалить
                      </Button>
                    </SheetFooter>
                  )}
                </>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!lessonToDelete}
        onOpenChange={(open) => { if (!open) setLessonToDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить урок?</AlertDialogTitle>
            <AlertDialogDescription>
              {lessonToDelete && `Урок «${lessonToDelete.title}» будет удалён. Действие необратимо.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => { if (lessonToDelete) handleDelete(lessonToDelete.id); }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
