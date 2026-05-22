'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getAssignment,
  getStudentAssignments,
  updateStudentAssignment,
  type Assignment,
  type StudentAssignment,
} from '@/lib/api';
import { ChevronLeft, Link2, Loader2 } from 'lucide-react';
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

const statusLabels: Record<string, string> = {
  assigned: 'Назначено',
  submitted: 'На проверке',
  reviewed: 'Проверено',
  needs_revision: 'На доработке',
};

const statusVariants: Record<string, 'default' | 'secondary' | 'destructive'> = {
  assigned: 'secondary',
  submitted: 'secondary',
  reviewed: 'default',
  needs_revision: 'destructive',
};

export default function AssignmentDetailPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const params = useParams();
  const assignmentId = params.id as string;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // Текст разбора, который преподаватель пишет к сдаче (по id назначения).
  const [reviewTexts, setReviewTexts] = useState<Record<string, string>>({});

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
    setUpdatingId(saId);
    try {
      await updateStudentAssignment(accessToken, saId, {
        status,
        reviewText: reviewTexts[saId]?.trim() || undefined,
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

  const typeLabel = assignment?.type === 'long' ? 'Длинное' : 'Короткое';
  const dueDateStr = assignment?.dueDate
    ? new Date(assignment.dueDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <>
      <div className="mb-4">
        <button
          onClick={() => router.back()}
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
              <div className="rounded-lg border bg-card px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Задание ещё не назначено ни одному студенту.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Студент</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Отправлено</TableHead>
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
                          <div className="flex flex-col gap-2">
                            {sa.status === 'submitted' && (
                              <div className="flex flex-col gap-1.5">
                                <Label htmlFor={`review-${sa.id}`} className="text-xs text-muted-foreground">
                                  Разбор работы (вердикт + комментарий)
                                </Label>
                                <Textarea
                                  id={`review-${sa.id}`}
                                  value={reviewTexts[sa.id] ?? ''}
                                  onChange={(e) =>
                                    setReviewTexts((prev) => ({ ...prev, [sa.id]: e.target.value }))
                                  }
                                  placeholder="Что получилось, что доработать. Видит студент."
                                  rows={3}
                                  className="min-w-[260px]"
                                />
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
