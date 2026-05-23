'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getAssignment,
  getStudentAssignments,
  updateStudentAssignment,
  createAssignment,
  fileDownloadUrl,
  type Assignment,
  type StudentAssignment,
} from '@/lib/api';
import { ChevronLeft, Download, FileText, Link2, Loader2 } from 'lucide-react';
import { useBack } from '@/components/back-button';
import { toast } from 'sonner';
import { MarkdownLightbox, isMarkdownFile } from '@/components/assignments/markdown-lightbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  STATUS_LABELS as statusLabels,
  STATUS_VARIANT as statusVariants,
} from '@/lib/assignment-status';

export default function AssignmentDetailPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  // «Назад» уважает историю: вернуться откуда пришёл; иначе — к списку заданий.
  const goBack = useBack('/admin/assignments');
  const params = useParams();
  const assignmentId = params.id as string;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // Идёт ли сейчас выдача задания студентам (до-материализация StudentAssignment).
  const [issuing, setIssuing] = useState(false);
  // Текст разбора, который преподаватель пишет к сдаче (по id назначения).
  const [reviewTexts, setReviewTexts] = useState<Record<string, string>>({});
  // Подсветка обязательной причины при «На доработку» (по id назначения).
  const [reviewErrors, setReviewErrors] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    if (!accessToken || !assignmentId) return;
    setLoadingData(true);
    try {
      const [{ assignment: a }, { studentAssignments: sa }] = await Promise.all([
        getAssignment(accessToken, assignmentId),
        getStudentAssignments(accessToken, {}),
      ]);
      setAssignment(a);
      setStudentAssignments(sa.filter((s) => s.assignmentId === assignmentId));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, assignmentId]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') fetchData();
  }, [accessToken, user, fetchData]);

  const handleStatusChange = async (saId: string, status: 'reviewed' | 'needs_revision') => {
    if (!accessToken) return;
    const reviewText = reviewTexts[saId]?.trim();
    // Для «На доработку» причина обязательна (бэкенд отвечает 400 на пустую) —
    // валидируем до запроса и подсвечиваем поле.
    if (status === 'needs_revision' && !reviewText) {
      setReviewErrors((prev) => ({ ...prev, [saId]: true }));
      toast.error('Укажите причину доработки — она видна студенту.');
      return;
    }
    setUpdatingId(saId);
    try {
      await updateStudentAssignment(accessToken, saId, {
        status,
        reviewText: reviewText || undefined,
      });
      setReviewErrors((prev) => {
        const next = { ...prev };
        delete next[saId];
        return next;
      });
      setReviewTexts((prev) => {
        const next = { ...prev };
        delete next[saId];
        return next;
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления');
    } finally {
      setUpdatingId(null);
    }
  };

  // Выдать задание студентам потока: эндпоинт идемпотентен (skipDuplicates),
  // поэтому до-материализует пропущенных, не дублируя существующие назначения.
  const handleIssue = async () => {
    if (!accessToken || !assignment || issuing) return;
    setIssuing(true);
    try {
      await createAssignment(accessToken, {
        streamId: assignment.streamId,
        lessonId: assignment.lessonId ?? undefined,
        title: assignment.title,
        description: assignment.description ?? undefined,
        criteria: assignment.criteria ?? undefined,
        type: assignment.type,
        tags: assignment.tags,
        materials: assignment.materials,
        dueDate: assignment.dueDate ?? undefined,
      });
      await fetchData();
      toast.success('Задание выдано студентам');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось выдать задание');
    } finally {
      setIssuing(false);
    }
  };

  const typeLabel = assignment?.type === 'long' ? 'Длинное' : 'Короткое';
  const dueDateStr = assignment?.dueDate
    ? new Date(assignment.dueDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      <div className="mb-4">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Назад
        </button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{loadingData ? '...' : (assignment?.title ?? 'Задание')}</h1>
          {assignment?.stream && (
            <p className="text-sm text-muted-foreground">{`Поток: ${assignment.stream.name}`}</p>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loadingData ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !assignment ? (
        <div className="text-muted-foreground text-sm">Задание не найдено.</div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Assignment meta card */}
          <div className="rounded-lg border bg-card p-6">
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Тип</span>
                <span className="text-sm text-foreground">{typeLabel}</span>
              </div>
              {dueDateStr && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Дедлайн</span>
                  <span className="text-sm text-foreground">{dueDateStr}</span>
                </div>
              )}
              {assignment.lesson && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Урок</span>
                  <span className="text-sm text-foreground">{assignment.lesson.title}</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Студентов</span>
                <span className="text-sm text-foreground">{studentAssignments.length}</span>
              </div>
            </div>

            {assignment.description && (
              <div className="mt-4 border-t pt-4">
                <span className="mb-2 block text-xs text-muted-foreground">Описание</span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {assignment.description}
                </p>
              </div>
            )}

            {assignment.criteria && (
              <div className="mt-4 border-t pt-4">
                <span className="mb-2 block text-xs text-muted-foreground">Критерии оценки</span>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {assignment.criteria}
                </p>
              </div>
            )}

            {assignment.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {assignment.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {assignment.materials.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <span className="mb-2 block text-xs text-muted-foreground">Материалы</span>
                <div className="flex flex-col gap-1">
                  {assignment.materials.map((m, i) => (
                    <a
                      key={i}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-foreground transition-colors hover:text-muted-foreground"
                    >
                      <Link2 className="size-4" />
                      {m.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Student assignments table */}
          <div>
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Студенты</h2>

            {studentAssignments.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-lg border bg-card px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Задание ещё не назначено ни одному студенту.
                </p>
                <Button onClick={handleIssue} disabled={issuing}>
                  {issuing && <Loader2 className="animate-spin" />}
                  Выдать студентам
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Студент</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Отправлено</TableHead>
                      <TableHead>Работа</TableHead>
                      <TableHead>Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {studentAssignments.map((sa) => (
                      <TableRow key={sa.id}>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">
                              {sa.student?.name ?? '—'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {sa.student?.email ?? ''}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariants[sa.status] ?? 'secondary'}>
                            {statusLabels[sa.status] ?? sa.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {sa.submittedAt
                            ? new Date(sa.submittedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {sa.fileName ? (
                            <div className="flex max-w-[240px] flex-col gap-1.5">
                              <div className="flex items-center gap-2 text-sm">
                                <FileText className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate text-foreground" title={sa.fileName}>
                                  {sa.fileName}
                                </span>
                              </div>
                              {sa.fileSignedUrl && (
                                <div className="flex items-center gap-1">
                                  {isMarkdownFile(sa.fileName) && (
                                    <MarkdownLightbox fileName={sa.fileName} url={sa.fileSignedUrl} />
                                  )}
                                  <Button
                                    asChild
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground"
                                  >
                                    <a href={fileDownloadUrl(sa.fileSignedUrl)}>
                                      <Download className="size-4" />
                                      Скачать
                                    </a>
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            {sa.status === 'submitted' && (
                              <div className="flex flex-col gap-1.5">
                                <Label htmlFor={`review-${sa.id}`} className="text-xs text-muted-foreground">
                                  Разбор работы (вердикт + комментарий)
                                </Label>
                                <Textarea
                                  id={`review-${sa.id}`}
                                  value={reviewTexts[sa.id] ?? ''}
                                  onChange={(e) => {
                                    setReviewTexts((prev) => ({ ...prev, [sa.id]: e.target.value }));
                                    if (reviewErrors[sa.id]) {
                                      setReviewErrors((prev) => {
                                        const next = { ...prev };
                                        delete next[sa.id];
                                        return next;
                                      });
                                    }
                                  }}
                                  placeholder="Что получилось, что доработать. Видит студент."
                                  rows={3}
                                  aria-invalid={reviewErrors[sa.id] ? true : undefined}
                                  // На узких экранах поле сжимается, на десктопе остаётся комфортным.
                                  className="w-full sm:min-w-[260px]"
                                />
                                {reviewErrors[sa.id] && (
                                  <span className="text-xs text-destructive">
                                    Для «На доработку» причина обязательна.
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              {sa.student && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => router.push(`/admin/students/${sa.student!.id}/thread`)}
                                >
                                  Сообщения
                                </Button>
                              )}
                              {sa.status === 'submitted' && (
                                <>
                                  <Button
                                    size="sm"
                                    disabled={updatingId === sa.id}
                                    onClick={() => handleStatusChange(sa.id, 'reviewed')}
                                  >
                                    {updatingId === sa.id && <Loader2 className="animate-spin" />}
                                    Принять
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={updatingId === sa.id}
                                    onClick={() => handleStatusChange(sa.id, 'needs_revision')}
                                  >
                                    {updatingId === sa.id && <Loader2 className="animate-spin" />}
                                    На доработку
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
