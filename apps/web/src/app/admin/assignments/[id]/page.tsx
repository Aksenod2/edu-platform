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
      await updateStudentAssignment(accessToken, saId, { status });
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
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm font-mono uppercase tracking-wider transition-colors"
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
          <div className="rounded-md border bg-card p-6">
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Тип
                </span>
                <span className="text-foreground text-sm">{typeLabel}</span>
              </div>
              {dueDateStr && (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                    Дедлайн
                  </span>
                  <span className="text-foreground text-sm">{dueDateStr}</span>
                </div>
              )}
              {assignment.lesson && (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                    Урок
                  </span>
                  <span className="text-foreground text-sm">{assignment.lesson.title}</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                  Студентов
                </span>
                <span className="font-mono text-xs text-foreground">
                  {studentAssignments.length}
                </span>
              </div>
            </div>

            {assignment.description && (
              <div className="mt-4 pt-4 border-t">
                <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
                  Описание
                </span>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {assignment.description}
                </p>
              </div>
            )}

            {assignment.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {assignment.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-md border text-muted-foreground text-xs font-mono uppercase"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {assignment.materials.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
                  Материалы
                </span>
                <div className="flex flex-col gap-1">
                  {assignment.materials.map((m, i) => (
                    <a
                      key={i}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-foreground hover:text-muted-foreground text-sm transition-colors"
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
            <span className="block font-mono text-xs text-muted-foreground uppercase tracking-widest mb-4">
              Студенты
            </span>

            {studentAssignments.length === 0 ? (
              <div className="rounded-md border bg-card px-6 py-8 text-center">
                <p className="text-muted-foreground text-sm">
                  Задание ещё не назначено ни одному студенту.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b">
                      {['Студент', 'Статус', 'Отправлено', 'Действия'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-muted-foreground font-mono text-xs uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {studentAssignments.map((sa) => (
                      <tr
                        key={sa.id}
                        className="border-b hover:bg-card transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-foreground font-medium">
                              {sa.student?.name ?? '—'}
                            </span>
                            <span className="text-muted-foreground text-xs font-mono">
                              {sa.student?.email ?? ''}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariants[sa.status] ?? 'secondary'}>
                            {statusLabels[sa.status] ?? sa.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-muted-foreground text-xs font-mono">
                            {sa.submittedAt
                              ? new Date(sa.submittedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                              : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {sa.student && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => router.push(`/admin/students/${sa.student!.id}/thread`)}
                              >
                                Тред
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
