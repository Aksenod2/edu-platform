'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
import { MarkdownContent } from '@/components/markdown/markdown-content';
import {
  getStudentDynamic,
  updateStudentDynamicRoadmap,
  createStudentDynamicEntry,
  updateStudentDynamicEntry,
  deleteStudentDynamicEntry,
  type StudentDynamic,
  type StudentDynamicEntry,
} from '@/lib/api';

// Шаблон-плейсхолдер для пустого roadmap: три согласованные секции.
const ROADMAP_TEMPLATE = `## С чем пришёл

_Уровень, цели, ожидания на старте._

## В процессе

_Над чем работаем сейчас, сильные стороны и зоны роста._

## С чем ушёл

_Результаты, освоенные навыки, рекомендации._
`;

const MARKDOWN_HINT = 'Поддерживается Markdown';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function StudentDynamicTab({
  accessToken,
  studentId,
}: {
  accessToken: string;
  studentId: string;
}) {
  const [data, setData] = useState<StudentDynamic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDynamic = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getStudentDynamic(accessToken, studentId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить динамику');
    } finally {
      setLoading(false);
    }
  }, [accessToken, studentId]);

  useEffect(() => {
    fetchDynamic();
  }, [fetchDynamic]);

  // ── Roadmap edit state ──
  const [editingRoadmap, setEditingRoadmap] = useState(false);
  const [roadmapDraft, setRoadmapDraft] = useState('');
  const [savingRoadmap, setSavingRoadmap] = useState(false);
  const [confirmCancelRoadmap, setConfirmCancelRoadmap] = useState(false);
  const roadmapRef = useRef<HTMLTextAreaElement>(null);

  const roadmapValue = data?.roadmap ?? '';
  const roadmapDirty = roadmapDraft !== roadmapValue;

  const startEditRoadmap = () => {
    // Пустой roadmap открываем с шаблоном-подсказкой, заполненный — как есть.
    setRoadmapDraft(roadmapValue || ROADMAP_TEMPLATE);
    setEditingRoadmap(true);
  };

  // Фокус в Textarea при входе в правку roadmap.
  useEffect(() => {
    if (editingRoadmap) roadmapRef.current?.focus();
  }, [editingRoadmap]);

  const cancelEditRoadmap = () => {
    if (roadmapDirty) {
      setConfirmCancelRoadmap(true);
      return;
    }
    setEditingRoadmap(false);
  };

  const handleSaveRoadmap = async () => {
    setSavingRoadmap(true);
    try {
      // PUT возвращает только мету roadmap (без ленты) — мёржим, сохраняя entries.
      const meta = await updateStudentDynamicRoadmap(accessToken, studentId, roadmapDraft);
      setData((prev) => ({ entries: prev?.entries ?? [], ...meta }));
      setEditingRoadmap(false);
      toast.success('Roadmap сохранён');
    } catch (err) {
      // Не выкидываем из режима правки и не теряем текст — только сообщаем об ошибке.
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить roadmap');
    } finally {
      setSavingRoadmap(false);
    }
  };

  // ── New entry state ──
  const [addingEntry, setAddingEntry] = useState(false);
  const [newEntryDraft, setNewEntryDraft] = useState('');
  const [creatingEntry, setCreatingEntry] = useState(false);
  const newEntryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (addingEntry) newEntryRef.current?.focus();
  }, [addingEntry]);

  const handleCreateEntry = async () => {
    const content = newEntryDraft.trim();
    if (!content) return;
    setCreatingEntry(true);
    try {
      const { entry } = await createStudentDynamicEntry(accessToken, studentId, content);
      setData((prev) =>
        prev ? { ...prev, entries: [entry, ...prev.entries] } : prev,
      );
      setNewEntryDraft('');
      setAddingEntry(false);
      toast.success('Запись добавлена');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось добавить запись');
    } finally {
      setCreatingEntry(false);
    }
  };

  // ── Entry callbacks ──
  const handleEntrySaved = useCallback((updated: StudentDynamicEntry) => {
    setData((prev) =>
      prev
        ? { ...prev, entries: prev.entries.map((e) => (e.id === updated.id ? updated : e)) }
        : prev,
    );
  }, []);

  const handleEntryDeleted = useCallback((entryId: string) => {
    setData((prev) =>
      prev ? { ...prev, entries: prev.entries.filter((e) => e.id !== entryId) } : prev,
    );
  }, []);

  // ── Render: loading / error ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PrivacyBanner />
        <Skeleton className="h-9 w-48" />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <PrivacyBanner />
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error || 'Не удалось загрузить динамику'}</span>
            <Button variant="outline" size="lg" onClick={fetchDynamic}>
              <RotateCw className="size-4" aria-hidden="true" />
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const hasRoadmap = roadmapValue.trim().length > 0;
  const hasEntries = data.entries.length > 0;
  const isEmpty = !hasRoadmap && !hasEntries && !editingRoadmap && !addingEntry;

  return (
    <div className="space-y-6">
      <PrivacyBanner />

      {isEmpty ? (
        <EmptyState
          onFillRoadmap={startEditRoadmap}
          onAddEntry={() => setAddingEntry(true)}
        />
      ) : (
        <>
          {/* ── Roadmap-шапка ── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <TrendingUp className="size-5 text-muted-foreground" aria-hidden="true" />
                Roadmap
              </h2>
              {!editingRoadmap && (
                <Button variant="outline" size="lg" onClick={startEditRoadmap} aria-label="Редактировать roadmap">
                  <Pencil className="size-4" aria-hidden="true" />
                  Редактировать
                </Button>
              )}
            </div>

            <Card>
              <CardContent>
                {editingRoadmap ? (
                  <div className="space-y-3">
                    <Textarea
                      ref={roadmapRef}
                      value={roadmapDraft}
                      onChange={(e) => setRoadmapDraft(e.target.value)}
                      maxLength={50000}
                      className="min-h-[240px] resize-y font-mono text-sm"
                      placeholder="С чем пришёл / В процессе / С чем ушёл…"
                      aria-label="Текст roadmap"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <Button size="lg" onClick={handleSaveRoadmap} disabled={savingRoadmap}>
                        {savingRoadmap && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                        Сохранить
                      </Button>
                      <Button
                        variant="ghost"
                        size="lg"
                        onClick={cancelEditRoadmap}
                        disabled={savingRoadmap}
                      >
                        Отмена
                      </Button>
                      {roadmapDirty && (
                        <span className="text-xs text-muted-foreground">
                          Есть несохранённые изменения
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{MARKDOWN_HINT}</span>
                    </div>
                  </div>
                ) : hasRoadmap ? (
                  <MarkdownContent content={roadmapValue} />
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Roadmap ещё не заполнен. Опишите путь ученика: с чем пришёл, что
                      в процессе, с чем ушёл.
                    </p>
                    <Button variant="outline" size="lg" onClick={startEditRoadmap}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Заполнить roadmap
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {!editingRoadmap && hasRoadmap && data.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Обновлено: {formatDateTime(data.updatedAt)}
                {data.updatedByName ? ` (${data.updatedByName})` : ''}
              </p>
            )}
          </section>

          {/* ── Лента записей ── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Записи</h2>
              {!addingEntry && (
                <Button size="lg" onClick={() => setAddingEntry(true)} aria-label="Добавить запись">
                  <Plus className="size-4" aria-hidden="true" />
                  Добавить запись
                </Button>
              )}
            </div>

            {addingEntry && (
              <Card>
                <CardContent className="space-y-3">
                  <Textarea
                    ref={newEntryRef}
                    value={newEntryDraft}
                    onChange={(e) => setNewEntryDraft(e.target.value)}
                    maxLength={50000}
                    className="min-h-[120px] resize-y font-mono text-sm"
                    placeholder="Что произошло, наблюдения, прогресс…"
                    aria-label="Текст новой записи"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      size="lg"
                      onClick={handleCreateEntry}
                      disabled={creatingEntry || !newEntryDraft.trim()}
                    >
                      {creatingEntry && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                      Сохранить
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={() => {
                        setAddingEntry(false);
                        setNewEntryDraft('');
                      }}
                      disabled={creatingEntry}
                    >
                      Отмена
                    </Button>
                    <span className="ml-auto text-xs text-muted-foreground">{MARKDOWN_HINT}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {hasEntries ? (
              <div className="space-y-3">
                {data.entries.map((entry) => (
                  <DynamicEntryCard
                    key={entry.id}
                    accessToken={accessToken}
                    studentId={studentId}
                    entry={entry}
                    onSaved={handleEntrySaved}
                    onDeleted={handleEntryDeleted}
                  />
                ))}
              </div>
            ) : (
              !addingEntry && (
                <Card>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">Записей пока нет.</p>
                  </CardContent>
                </Card>
              )
            )}
          </section>
        </>
      )}

      {/* Подтверждение отмены правки roadmap при наличии изменений */}
      <AlertDialog open={confirmCancelRoadmap} onOpenChange={setConfirmCancelRoadmap}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить изменения?</AlertDialogTitle>
            <AlertDialogDescription>
              Несохранённые изменения roadmap будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Продолжить правку</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setEditingRoadmap(false);
                setConfirmCancelRoadmap(false);
              }}
            >
              Отменить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Плашка приватности ─── */

function PrivacyBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
      <EyeOff className="size-4 shrink-0" aria-hidden="true" />
      <span>Внутренние заметки преподавателя — ученик их не видит.</span>
    </div>
  );
}

/* ─── Onboarding (пусто) ─── */

function EmptyState({
  onFillRoadmap,
  onAddEntry,
}: {
  onFillRoadmap: () => void;
  onAddEntry: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <TrendingUp className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Динамика ещё не заполнена</h3>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Опишите путь ученика в roadmap (с чем пришёл / в процессе / с чем ушёл) и
            ведите ленту датированных записей о прогрессе.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={onFillRoadmap}>
            <Pencil className="size-4" aria-hidden="true" />
            Заполнить roadmap
          </Button>
          <Button variant="outline" size="lg" onClick={onAddEntry}>
            <Plus className="size-4" aria-hidden="true" />
            Добавить запись
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Карточка записи ленты ─── */

function DynamicEntryCard({
  accessToken,
  studentId,
  entry,
  onSaved,
  onDeleted,
}: {
  accessToken: string;
  studentId: string;
  entry: StudentDynamicEntry;
  onSaved: (entry: StudentDynamicEntry) => void;
  onDeleted: (entryId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = draft !== entry.content;

  const startEdit = () => {
    setDraft(entry.content);
    setEditing(true);
  };

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const cancelEdit = () => {
    if (dirty) {
      setConfirmCancel(true);
      return;
    }
    setEditing(false);
  };

  const handleSave = async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const { entry: updated } = await updateStudentDynamicEntry(
        accessToken,
        studentId,
        entry.id,
        content,
      );
      onSaved(updated);
      setEditing(false);
      toast.success('Запись обновлена');
    } catch (err) {
      // Остаёмся в правке, текст не теряем.
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить запись');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteStudentDynamicEntry(accessToken, studentId, entry.id);
      onDeleted(entry.id);
      toast.success('Запись удалена');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить запись');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              {formatDateTime(entry.createdAt)}
            </span>
            {entry.authorName && (
              <span className="text-xs text-muted-foreground">{entry.authorName}</span>
            )}
          </div>
          {!editing && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="lg" onClick={startEdit} aria-label="Редактировать запись">
                <Pencil className="size-4" aria-hidden="true" />
                Редактировать
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => setConfirmDelete(true)}
                aria-label="Удалить запись"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Удалить
              </Button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={50000}
              className="min-h-[120px] resize-y font-mono text-sm"
              aria-label="Текст записи"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={handleSave} disabled={saving || !draft.trim()}>
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Сохранить
              </Button>
              <Button variant="ghost" size="lg" onClick={cancelEdit} disabled={saving}>
                Отмена
              </Button>
              {dirty && (
                <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{MARKDOWN_HINT}</span>
            </div>
          </div>
        ) : (
          <MarkdownContent content={entry.content} />
        )}
      </CardContent>

      {/* Подтверждение удаления записи */}
      <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleting && setConfirmDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись от {formatDateTime(entry.createdAt)} будет удалена без возможности
              восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Подтверждение отмены правки записи при наличии изменений */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить изменения?</AlertDialogTitle>
            <AlertDialogDescription>
              Несохранённые изменения записи будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Продолжить правку</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setEditing(false);
                setConfirmCancel(false);
              }}
            >
              Отменить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
