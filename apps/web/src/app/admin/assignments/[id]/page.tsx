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
import { PageHeader } from '@platform/ui/templates';
import { Button, Badge, Spinner, Mono } from '@platform/ui/atoms';

const statusLabels: Record<string, string> = {
  assigned: 'Назначено',
  submitted: 'На проверке',
  reviewed: 'Проверено',
  needs_revision: 'На доработке',
};

const statusVariants: Record<string, 'warning' | 'info' | 'success' | 'error'> = {
  assigned: 'warning',
  submitted: 'info',
  reviewed: 'success',
  needs_revision: 'error',
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
          className="flex items-center gap-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-sm font-mono uppercase tracking-[var(--tracking-wider)] transition-colors duration-[var(--duration-fast)]"
        >
          <ChevronLeftIcon />
          Назад
        </button>
      </div>

      <PageHeader
        title={loadingData ? '...' : (assignment?.title ?? 'Задание')}
        subtitle={assignment?.stream ? `Поток: ${assignment.stream.name}` : undefined}
      />

      {error && (
        <div className="px-4 py-3 mb-4 rounded-[var(--radius-xs)] border border-[var(--color-error)] bg-[var(--color-error-dim)] text-[var(--color-error)] text-sm font-sans">
          {error}
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : !assignment ? (
        <div className="text-[var(--color-text-tertiary)] text-sm font-sans">Задание не найдено.</div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Assignment meta card */}
          <div className="rounded-[var(--radius-xs)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6">
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-1">
                <Mono size="xs" className="text-[var(--color-text-tertiary)] uppercase tracking-[var(--tracking-wider)]">
                  Тип
                </Mono>
                <span className="text-[var(--color-text-primary)] text-sm font-sans">{typeLabel}</span>
              </div>
              {dueDateStr && (
                <div className="flex flex-col gap-1">
                  <Mono size="xs" className="text-[var(--color-text-tertiary)] uppercase tracking-[var(--tracking-wider)]">
                    Дедлайн
                  </Mono>
                  <span className="text-[var(--color-text-primary)] text-sm font-sans">{dueDateStr}</span>
                </div>
              )}
              {assignment.lesson && (
                <div className="flex flex-col gap-1">
                  <Mono size="xs" className="text-[var(--color-text-tertiary)] uppercase tracking-[var(--tracking-wider)]">
                    Урок
                  </Mono>
                  <span className="text-[var(--color-text-primary)] text-sm font-sans">{assignment.lesson.title}</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Mono size="xs" className="text-[var(--color-text-tertiary)] uppercase tracking-[var(--tracking-wider)]">
                  Студентов
                </Mono>
                <Mono size="xs" className="text-[var(--color-text-primary)]">
                  {studentAssignments.length}
                </Mono>
              </div>
            </div>

            {assignment.description && (
              <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                <Mono size="xs" className="text-[var(--color-text-tertiary)] uppercase tracking-[var(--tracking-wider)] mb-2">
                  Описание
                </Mono>
                <p className="text-[var(--color-text-secondary)] text-sm font-sans leading-relaxed">
                  {assignment.description}
                </p>
              </div>
            )}

            {assignment.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {assignment.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-[var(--radius-xs)] border border-[var(--color-border-default)] text-[var(--color-text-tertiary)] text-xs font-mono uppercase"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {assignment.materials.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                <Mono size="xs" className="text-[var(--color-text-tertiary)] uppercase tracking-[var(--tracking-wider)] mb-2">
                  Материалы
                </Mono>
                <div className="flex flex-col gap-1">
                  {assignment.materials.map((m, i) => (
                    <a
                      key={i}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[var(--color-accent-red)] hover:text-[var(--color-text-primary)] text-sm font-sans transition-colors duration-[var(--duration-fast)]"
                    >
                      <LinkIcon />
                      {m.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Student assignments table */}
          <div>
            <Mono size="xs" className="text-[var(--color-text-tertiary)] uppercase tracking-[var(--tracking-widest)] mb-4">
              Студенты
            </Mono>

            {studentAssignments.length === 0 ? (
              <div className="rounded-[var(--radius-xs)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-6 py-8 text-center">
                <p className="text-[var(--color-text-tertiary)] text-sm font-sans">
                  Задание ещё не назначено ни одному студенту.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-sans text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-strong)]">
                      {['Студент', 'Статус', 'Отправлено', 'Действия'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-[var(--color-text-tertiary)] font-mono text-xs uppercase tracking-[var(--tracking-wider)]"
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
                        className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface)] transition-colors duration-[var(--duration-fast)]"
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[var(--color-text-primary)] font-medium">
                              {sa.student?.name ?? '—'}
                            </span>
                            <span className="text-[var(--color-text-tertiary)] text-xs font-mono">
                              {sa.student?.email ?? ''}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariants[sa.status] ?? 'warning'}>
                            {statusLabels[sa.status] ?? sa.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[var(--color-text-secondary)] text-xs font-mono">
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
                                  variant="primary"
                                  size="sm"
                                  loading={updatingId === sa.id}
                                  onClick={() => handleStatusChange(sa.id, 'reviewed')}
                                >
                                  Принять
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  loading={updatingId === sa.id}
                                  onClick={() => handleStatusChange(sa.id, 'needs_revision')}
                                >
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

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9 2L4 7l5 5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a3 3 0 004.24 0l2-2A3 3 0 008 1.76L6.75 3" />
      <path d="M8 6a3 3 0 00-4.24 0l-2 2A3 3 0 005.76 12.24L7 11" />
    </svg>
  );
}
