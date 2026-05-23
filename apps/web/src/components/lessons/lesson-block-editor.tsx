'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { Loader2, X, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getLesson,
  updateLesson,
  deleteLesson,
  getTeachers,
  type AssignmentMaterial,
  type LessonMaterial,
  type Teacher,
} from '@/lib/api';
import { TeacherPicker } from '@/components/lessons/teacher-picker';
import { LessonVideosManager } from '@/components/lessons/lesson-videos-manager';
import { LessonScheduleSection } from '@/components/lessons/lesson-schedule-section';
import { LessonMaterialsSection } from '@/components/lessons/lesson-materials-section';
import { AssignmentMaterialsField } from '@/components/lessons/assignment-materials-field';
import {
  type AssignmentType,
  type LessonBlock,
} from '@/components/lessons/lesson-block';

const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  short: 'Короткое',
  long: 'Развёрнутое',
};

type FormState = {
  title: string;
  summary: string;
  notes: string;
  teacherIds: string[];
  hasAssignment: boolean;
  assignmentTitle: string;
  assignmentDescription: string;
  assignmentCriteria: string;
  assignmentType: AssignmentType;
  assignmentTags: string[];
  assignmentMaterials: AssignmentMaterial[];
};

function lessonToForm(lesson: LessonBlock): FormState {
  return {
    title: lesson.title,
    summary: lesson.summary || '',
    notes: lesson.notes || '',
    teacherIds: (lesson.teachers ?? []).map((t) => t.id),
    hasAssignment: lesson.hasAssignment ?? false,
    assignmentTitle: lesson.assignmentTitle || '',
    assignmentDescription: lesson.assignmentDescription || '',
    assignmentCriteria: lesson.assignmentCriteria || '',
    assignmentType: lesson.assignmentType ?? 'short',
    assignmentTags: lesson.assignmentTags ?? [],
    assignmentMaterials: lesson.assignmentMaterials ?? [],
  };
}

// Полноценный редактор урока-БЛОКА (копилка): видео, материалы, преподаватели,
// свёрнутое задание. Расписание (Session потока) здесь НЕ показываем.
export function LessonBlockEditor({ lessonId }: { lessonId: string }) {
  const { accessToken } = useAuth();
  const router = useRouter();

  const [lesson, setLesson] = useState<LessonBlock | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [{ lesson: l }, { teachers: t }] = await Promise.all([
        getLesson(accessToken, lessonId),
        getTeachers(accessToken),
      ]);
      setLesson(l);
      setForm(lessonToForm(l));
      setTeachers(t);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Ошибка загрузки урока');
    } finally {
      setLoading(false);
    }
  }, [accessToken, lessonId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Видео/материалы пишутся отдельными запросами и возвращают свежий урок —
  // обновляем локальное состояние без полного рефетча.
  const handleMaterialsChange = (materials: LessonMaterial[]) => {
    setLesson((prev) => (prev ? { ...prev, materials } : prev));
  };

  const toggleTeacher = (id: string) =>
    setForm((prev) =>
      prev
        ? {
            ...prev,
            teacherIds: prev.teacherIds.includes(id)
              ? prev.teacherIds.filter((t) => t !== id)
              : [...prev.teacherIds, id],
          }
        : prev,
    );

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || !form) return;
    if (!form.assignmentTags.includes(tag)) {
      setForm({ ...form, assignmentTags: [...form.assignmentTags, tag] });
    }
    setTagInput('');
  };

  const removeTag = (tag: string) =>
    setForm((prev) =>
      prev ? { ...prev, assignmentTags: prev.assignmentTags.filter((t) => t !== tag) } : prev,
    );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !form || !form.title.trim()) return;
    setSaving(true);
    try {
      // Шлём поля всегда (даже пустыми), иначе очистку не сохранить:
      // пустая строка на бэке превращается в null.
      await updateLesson(accessToken, lessonId, {
        title: form.title.trim(),
        summary: form.summary,
        notes: form.notes,
        teacherIds: form.teacherIds,
        hasAssignment: form.hasAssignment,
        assignmentTitle: form.assignmentTitle,
        assignmentDescription: form.assignmentDescription,
        assignmentCriteria: form.assignmentCriteria,
        assignmentType: form.assignmentType,
        assignmentTags: form.assignmentTags,
        assignmentMaterials: form.assignmentMaterials,
      });
      // После сохранения закрываем страницу — возврат к списку уроков. Видео,
      // материалы, расписание и выдача ДЗ сохраняются отдельными действиями.
      toast.success('Урок сохранён');
      router.push('/admin/lessons');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!accessToken) return;
    setDeleting(true);
    try {
      await deleteLesson(accessToken, lessonId);
      toast.success('Урок удалён');
      router.push('/admin/lessons');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !lesson || !form) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError || 'Урок не найден'}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="lesson-title">Название *</FieldLabel>
          <Input
            id="lesson-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Название урока"
          />
        </Field>

        <Field>
          <LessonScheduleSection accessToken={accessToken!} lessonId={lessonId} />
        </Field>

        <Field>
          <LessonVideosManager
            accessToken={accessToken!}
            lessonId={lessonId}
            videos={lesson.videos ?? []}
            onChange={(videos) =>
              setLesson((prev) => (prev ? { ...prev, videos } : prev))
            }
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

        <Field>
          <LessonMaterialsSection
            accessToken={accessToken!}
            lessonId={lessonId}
            materials={lesson.materials ?? []}
            onChange={handleMaterialsChange}
          />
        </Field>

        <Field>
          <FieldLabel>Преподаватели</FieldLabel>
          <TeacherPicker
            teachers={teachers}
            selected={form.teacherIds}
            onToggle={toggleTeacher}
          />
        </Field>
      </FieldGroup>

      <Separator />

      {/* Свёрнутое в блок задание (folded assignment). */}
      <div className="flex flex-col gap-4 rounded-lg border bg-muted p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={form.hasAssignment}
            onCheckedChange={(v) => setForm({ ...form, hasAssignment: v === true })}
          />
          Задание к уроку
        </label>

        {form.hasAssignment && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="assignment-title">Название задания</FieldLabel>
              <Input
                id="assignment-title"
                value={form.assignmentTitle}
                onChange={(e) => setForm({ ...form, assignmentTitle: e.target.value })}
                placeholder="Название задания"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="assignment-description">Описание</FieldLabel>
              <Textarea
                id="assignment-description"
                value={form.assignmentDescription}
                onChange={(e) =>
                  setForm({ ...form, assignmentDescription: e.target.value })
                }
                placeholder="Что нужно сделать..."
                rows={4}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="assignment-criteria">Критерии оценки</FieldLabel>
              <Textarea
                id="assignment-criteria"
                value={form.assignmentCriteria}
                onChange={(e) =>
                  setForm({ ...form, assignmentCriteria: e.target.value })
                }
                placeholder="По каким критериям оцениваем работу..."
                rows={3}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="assignment-type">Тип ответа</FieldLabel>
              <Select
                value={form.assignmentType}
                onValueChange={(v) =>
                  setForm({ ...form, assignmentType: v as AssignmentType })
                }
              >
                <SelectTrigger id="assignment-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ASSIGNMENT_TYPE_LABELS) as AssignmentType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {ASSIGNMENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="assignment-tags">Теги</FieldLabel>
              {form.assignmentTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.assignmentTags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                        <span className="sr-only">Убрать тег</span>
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  id="assignment-tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="Добавить тег и нажать Enter"
                />
                <Button type="button" variant="outline" onClick={addTag}>
                  Добавить
                </Button>
              </div>
            </Field>

            <Field>
              <AssignmentMaterialsField
                accessToken={accessToken!}
                materials={form.assignmentMaterials}
                onChange={(m) => setForm({ ...form, assignmentMaterials: m })}
              />
            </Field>
          </FieldGroup>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !form.title.trim()}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => setConfirmDelete(true)}
        >
          {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Удалить урок
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить урок?</AlertDialogTitle>
            <AlertDialogDescription>
              Урок «{lesson.title}» будет удалён из всех программ и снят со всех групп;
              сдачи студентов по нему тоже удалятся. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
