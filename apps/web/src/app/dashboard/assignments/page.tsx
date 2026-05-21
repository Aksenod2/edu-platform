'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Spinner, Button, Badge, Select } from '@platform/ui/atoms';
import {
  getStudentAssignments,
  submitStudentAssignment,
  getStreams,
  getThread,
  type StudentAssignment,
  type Stream,
  type ThreadEntry,
} from '@/lib/api';
import Link from 'next/link';

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Назначено',
  submitted: 'Отправлено',
  reviewed: 'Проверено',
  needs_revision: 'На доработке',
};

const STATUS_VARIANT: Record<string, 'warning' | 'info' | 'success' | 'error'> = {
  assigned: 'warning',
  submitted: 'info',
  reviewed: 'success',
  needs_revision: 'error',
};

const TYPE_LABELS: Record<string, string> = {
  short: 'Короткое',
  long: 'Длинное',
};

export default function StudentAssignmentsPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();

  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignmentFeedback, setAssignmentFeedback] = useState<Record<string, ThreadEntry | null>>({});
  const [submissionModalSaId, setSubmissionModalSaId] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const params: { streamId?: string; status?: string } = {};
      if (streamFilter) params.streamId = streamFilter;
      if (statusFilter) params.status = statusFilter;

      const [saData, streamsData] = await Promise.all([
        getStudentAssignments(accessToken, params),
        getStreams(accessToken),
      ]);
      setAssignments(saData.studentAssignments);
      setStreams(streamsData.streams.filter((s) => s.status === 'active'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, streamFilter, statusFilter]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') fetchData();
  }, [accessToken, user, fetchData]);

  const loadAssignmentFeedback = useCallback(
    async (assignmentId: string) => {
      if (!accessToken || !user || assignmentId in assignmentFeedback) return;
      try {
        const data = await getThread(accessToken, user.id, assignmentId);
        const adminComments = data.entries.filter(
          (e) => e.type === 'comment' && e.author.role === 'admin' && e.assignmentId === assignmentId,
        );
        const last = adminComments.length > 0 ? adminComments[adminComments.length - 1] : null;
        setAssignmentFeedback((prev) => ({ ...prev, [assignmentId]: last }));
      } catch {
        setAssignmentFeedback((prev) => ({ ...prev, [assignmentId]: null }));
      }
    },
    [accessToken, user, assignmentFeedback],
  );

  const handleToggleExpand = (saId: string, assignmentId: string | undefined, isReviewed: boolean) => {
    const nextExpanded = expandedId === saId ? null : saId;
    setExpandedId(nextExpanded);
    if (nextExpanded && isReviewed && assignmentId) {
      loadAssignmentFeedback(assignmentId);
    }
  };

  const openSubmissionForm = (saId: string) => {
    setSubmissionModalSaId(saId);
    setSubmissionText('');
    setSubmissionFile(null);
    setError('');
  };

  const closeSubmissionForm = () => {
    setSubmissionModalSaId(null);
    setSubmissionText('');
    setSubmissionFile(null);
  };

  const handleSubmit = async () => {
    if (!accessToken || !submissionModalSaId) return;
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await submitStudentAssignment(accessToken, submissionModalSaId, {
        answerText: submissionText || undefined,
        file: submissionFile || undefined,
      });
      setSuccess('Задание отправлено на проверку');
      setTimeout(() => setSuccess(''), 3000);
      closeSubmissionForm();
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="max-w-3xl">
        {/* Page header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 font-mono text-xs tracking-wide text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors mb-3 no-underline"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M9 2L4 7l5 5" />
            </svg>
            Назад
          </Link>
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Мои задания
          </h1>
          <p className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mt-1">
            {assignments.length} задани
            {assignments.length === 1 ? 'е' : assignments.length < 5 ? 'я' : 'й'}
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="flex justify-between items-center px-4 py-3 mb-4 border border-[var(--color-error)] bg-[var(--color-error-dim)] text-[var(--color-error)] text-sm select-text">
            <span>{error}</span>
            <button
              onClick={() => setError('')}
              className="bg-transparent border-0 cursor-pointer text-[var(--color-error)] text-base leading-none"
            >
              ×
            </button>
          </div>
        )}
        {success && (
          <div className="px-4 py-3 mb-4 border border-[var(--color-success)] bg-[var(--color-success-dim)] text-[var(--color-success)] text-sm">
            {success}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <Select
            value={streamFilter}
            onChange={(e) => setStreamFilter(e.target.value)}
            fullWidth={false}
            style={{ minWidth: 160 }}
          >
            <option value="">Все потоки</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            fullWidth={false}
            style={{ minWidth: 160 }}
          >
            <option value="">Все статусы</option>
            <option value="assigned">Назначено</option>
            <option value="submitted">Отправлено</option>
            <option value="reviewed">Проверено</option>
            <option value="needs_revision">На доработке</option>
          </Select>

          {(streamFilter || statusFilter) && (
            <button
              onClick={() => {
                setStreamFilter('');
                setStatusFilter('');
              }}
              className="flex items-center gap-1 px-3 py-2 border border-[var(--color-border-default)] bg-transparent text-[var(--color-text-tertiary)] font-mono text-xs tracking-widest uppercase cursor-pointer hover:text-[var(--color-text-primary)] transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2 2l8 8M10 2L2 10" />
              </svg>
              Сбросить
            </button>
          )}
        </div>

        {/* Content */}
        {loadingData ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 border border-dashed border-[var(--color-border-default)]">
            <div className="w-12 h-12 rounded-full border-2 border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-disabled)]">
              <ClipboardIcon />
            </div>
            <p className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] m-0">
              {statusFilter || streamFilter ? 'Нет заданий по фильтрам' : 'Заданий пока нет'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {assignments.map((sa) => {
              const a = sa.assignment;
              const isExpanded = expandedId === sa.id;
              const isOverdue =
                a?.dueDate &&
                new Date(a.dueDate) < new Date() &&
                (sa.status === 'assigned' || sa.status === 'needs_revision');

              return (
                <div
                  key={sa.id}
                  className="border bg-[var(--color-bg-surface)] overflow-hidden transition-colors"
                  style={{
                    borderColor: isOverdue ? 'var(--color-error)' : 'var(--color-border-default)',
                  }}
                >
                  {/* Card header */}
                  <button
                    onClick={() => handleToggleExpand(sa.id, a?.id, sa.status === 'reviewed')}
                    aria-expanded={isExpanded}
                    className="w-full px-5 py-4 cursor-pointer flex justify-between items-center border-0 text-left gap-4 transition-colors"
                    style={{ background: isExpanded ? 'var(--color-bg-elevated)' : 'transparent' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-sans font-medium text-base text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap mb-2">
                        {a?.title}
                      </div>
                      <div className="flex gap-2 items-center flex-wrap">
                        <Badge variant={STATUS_VARIANT[sa.status] ?? 'default'}>
                          {STATUS_LABELS[sa.status]}
                        </Badge>
                        {a?.type && (
                          <Badge variant="default">{TYPE_LABELS[a.type] ?? a.type}</Badge>
                        )}
                        {a && !a.groupId && <Badge variant="accent">Индивидуальное</Badge>}
                        {a?.stream && (
                          <span className="font-mono text-xs tracking-wide text-[var(--color-text-tertiary)]">
                            {a.stream.name}
                          </span>
                        )}
                        {a?.lesson && (
                          <span className="text-xs text-[var(--color-text-disabled)]">
                            Урок: {a.lesson.title}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-4 items-center shrink-0">
                      {a?.dueDate && (
                        <div className="text-right text-xs">
                          <div className="font-mono tracking-wide uppercase text-[var(--color-text-disabled)] mb-0.5">
                            Дедлайн
                          </div>
                          <div
                            className="font-mono"
                            style={{
                              color: isOverdue
                                ? 'var(--color-error)'
                                : 'var(--color-text-secondary)',
                              fontWeight: isOverdue ? 600 : undefined,
                            }}
                          >
                            {new Date(a.dueDate).toLocaleString('ru-RU', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </div>
                        </div>
                      )}
                      <ChevronIcon open={isExpanded} />
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-5 py-4 border-t border-[var(--color-border-subtle)]">
                      {a?.description ? (
                        <div className="mb-4">
                          <p className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-2">
                            Описание
                          </p>
                          <p className="whitespace-pre-wrap m-0 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                            {a.description}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[var(--color-text-disabled)] text-sm italic mb-4">
                          Описание не указано
                        </p>
                      )}

                      {a?.materials && a.materials.length > 0 && (
                        <div className="mb-4">
                          <p className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-2">
                            Материалы
                          </p>
                          <div className="flex flex-col gap-2">
                            {a.materials.map((m, i) => (
                              <a
                                key={i}
                                href={m.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={m.type === 'file' ? m.name : undefined}
                                className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] text-[var(--color-accent)] no-underline text-sm transition-opacity hover:opacity-80"
                              >
                                {m.type === 'file' ? (
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 14 14"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                  >
                                    <path d="M8 1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z" />
                                    <path d="M8 1v4h4M5 9l2 2 2-2M7 11V6" />
                                  </svg>
                                ) : (
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 14 14"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                  >
                                    <path d="M6 3H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" />
                                    <path d="M9 1h4v4M14 1L7 8" />
                                  </svg>
                                )}
                                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                  {m.name}
                                </span>
                                {m.type === 'file' && m.size && (
                                  <span className="text-xs text-[var(--color-text-disabled)] shrink-0">
                                    {Math.round(m.size / 1024)}KB
                                  </span>
                                )}
                                <span className="font-mono text-xs text-[var(--color-text-disabled)] shrink-0 uppercase">
                                  {m.type === 'file' ? 'Скачать' : 'Открыть'}
                                </span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {a?.tags && a.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap mb-4">
                          {a.tags.map((tag) => (
                            <span
                              key={tag}
                              className="font-mono text-xs bg-[var(--color-bg-overlay)] text-[var(--color-text-tertiary)] px-2 py-1 rounded-full border border-[var(--color-border-subtle)] tracking-wide"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Submitted answer */}
                      {(sa.status === 'submitted' || sa.status === 'reviewed') && sa.content && (
                        <div className="mb-4 px-4 py-3 bg-[var(--color-bg-overlay)] border-l-[3px] border-[var(--color-info)]">
                          <p className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-2">
                            Ваш ответ
                          </p>
                          <p className="whitespace-pre-wrap m-0 text-sm leading-relaxed text-[var(--color-text-secondary)] italic">
                            {sa.content}
                          </p>
                        </div>
                      )}

                      {(sa.status === 'submitted' || sa.status === 'reviewed') && sa.fileName && (
                        <div className="mb-4 flex items-center gap-3 px-3 py-2 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)]">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          >
                            <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z" />
                            <path d="M9 1v4h4" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
                              {sa.fileName}
                            </div>
                            {sa.fileSize && (
                              <div className="text-xs text-[var(--color-text-disabled)]">
                                {sa.fileSize < 1024 * 1024
                                  ? `${Math.round(sa.fileSize / 1024)} КБ`
                                  : `${(sa.fileSize / (1024 * 1024)).toFixed(1)} МБ`}
                              </div>
                            )}
                          </div>
                          {sa.fileSignedUrl && (
                            <a
                              href={sa.fileSignedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[var(--color-info)] no-underline"
                            >
                              Открыть ↗
                            </a>
                          )}
                        </div>
                      )}

                      {/* Teacher feedback */}
                      {sa.status === 'reviewed' &&
                        a?.id &&
                        (() => {
                          const feedback = assignmentFeedback[a.id];
                          if (feedback === undefined || feedback === null) return null;
                          return (
                            <div className="mb-4 p-4 border border-[rgba(57,255,20,0.2)] bg-[rgba(57,255,20,0.04)]">
                              <div className="flex items-center gap-2 mb-3">
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 14 14"
                                  fill="none"
                                  stroke="var(--color-success)"
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M2 2h10v7H5l-3 3V2z" />
                                  <path d="M4.5 5h5M4.5 7.5h3" />
                                </svg>
                                <span className="font-mono text-xs tracking-widest uppercase text-[var(--color-success)]">
                                  Фидбек учителя
                                </span>
                                <span className="font-mono text-xs text-[var(--color-text-disabled)] ml-auto">
                                  {new Date(feedback.createdAt).toLocaleString('ru-RU', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}{' '}
                                  · {feedback.author.name}
                                </span>
                              </div>
                              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap m-0">
                                {feedback.content}
                              </p>
                              <div className="flex gap-3 mt-3 pt-3 border-t border-[rgba(57,255,20,0.12)]">
                                <button
                                  onClick={() =>
                                    router.push(
                                      `/dashboard/thread?assignmentId=${a.id}&title=${encodeURIComponent(a.title || '')}`,
                                    )
                                  }
                                  className="font-mono text-xs tracking-widest uppercase text-[var(--color-info)] bg-transparent border-0 cursor-pointer flex items-center gap-1 p-0 hover:opacity-80 transition-opacity"
                                >
                                  Открыть в треде
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                      {/* Actions row */}
                      <div className="flex gap-5 items-center justify-between flex-wrap">
                        <div className="flex gap-5 font-mono text-xs text-[var(--color-text-disabled)] tracking-wide">
                          {sa.submittedAt && (
                            <span>
                              Отправлено:{' '}
                              {new Date(sa.submittedAt).toLocaleString('ru-RU', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </span>
                          )}
                          {sa.reviewedAt && (
                            <span>
                              Проверено:{' '}
                              {new Date(sa.reviewedAt).toLocaleString('ru-RU', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </span>
                          )}
                        </div>

                        <div className="flex gap-2 items-center">
                          <Link
                            href={`/dashboard/assignments/${sa.id}`}
                            className="flex items-center gap-1 px-3 py-2 border border-[var(--color-border-default)] text-[var(--color-text-secondary)] font-mono text-xs tracking-wide uppercase no-underline hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] transition-colors"
                          >
                            Подробнее
                          </Link>
                          <button
                            onClick={() =>
                              router.push(
                                `/dashboard/thread?assignmentId=${a?.id}&title=${encodeURIComponent(a?.title || '')}`,
                              )
                            }
                            className="flex items-center gap-1 px-3 py-2 border border-[var(--color-info)] text-[var(--color-info)] bg-transparent font-sans text-xs cursor-pointer hover:bg-[rgba(77,166,255,0.08)] transition-colors"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 14 14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <circle cx="7" cy="7" r="6" />
                              <path d="M5 5.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1.5-1.5 1.5" />
                              <circle cx="7" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
                            </svg>
                            Задать вопрос
                          </button>
                          {(sa.status === 'assigned' || sa.status === 'needs_revision') && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => openSubmissionForm(sa.id)}
                            >
                              {sa.status === 'needs_revision' ? 'Пересдать' : 'Отправить'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Submission Modal */}
      {submissionModalSaId &&
        (() => {
          const modalSa = assignments.find((s) => s.id === submissionModalSaId);
          const modalAssignment = modalSa?.assignment;
          const isShort = modalAssignment?.type === 'short';

          return (
            <div
              className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) closeSubmissionForm();
              }}
            >
              <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] w-full max-w-[520px] max-h-[90vh] overflow-auto p-6">
                <div className="mb-5 p-3 px-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
                  <div className="font-mono text-xs text-[var(--color-text-disabled)] tracking-widest uppercase mb-1">
                    Сдача задания
                  </div>
                  <div className="text-base font-medium text-[var(--color-text-primary)]">
                    {modalAssignment?.title}
                  </div>
                  <div className="flex gap-2 mt-2">
                    {modalAssignment?.type && (
                      <Badge variant="default">
                        {TYPE_LABELS[modalAssignment.type] ?? modalAssignment.type}
                      </Badge>
                    )}
                    {modalAssignment?.dueDate && (
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        Дедлайн:{' '}
                        {new Date(modalAssignment.dueDate).toLocaleString('ru-RU', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-2">
                    Ваш ответ {isShort && <span className="text-[var(--color-error)]">*</span>}
                  </label>
                  <textarea
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    placeholder="Опишите вашу работу кратко…"
                    maxLength={2000}
                    className="w-full min-h-[140px] resize-none p-3 border border-[var(--color-border-default)] bg-[var(--color-bg-input)] text-[var(--color-text-primary)] text-sm font-sans leading-relaxed outline-none focus:border-[var(--color-border-strong)] box-border"
                  />
                  <div className="text-right text-xs text-[var(--color-text-disabled)] mt-1">
                    {submissionText.length} / 2000
                  </div>
                </div>

                <div className="mb-5">
                  <label className="block font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-2">
                    Файл
                  </label>
                  {submissionFile ? (
                    <div className="flex items-center gap-3 px-3 py-2 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)]">
                      <Badge variant="default">
                        {submissionFile.name.split('.').pop()?.toUpperCase()}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                          {submissionFile.name}
                        </div>
                        <div className="text-xs text-[var(--color-text-disabled)]">
                          {submissionFile.size < 1024 * 1024
                            ? `${Math.round(submissionFile.size / 1024)} КБ`
                            : `${(submissionFile.size / (1024 * 1024)).toFixed(1)} МБ`}
                        </div>
                      </div>
                      <button
                        onClick={() => setSubmissionFile(null)}
                        className="bg-transparent border-0 cursor-pointer text-[var(--color-text-disabled)] text-base p-1"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-[var(--color-border-default)] cursor-pointer text-sm text-[var(--color-text-tertiary)] hover:border-[var(--color-border-strong)] transition-colors">
                      <input
                        type="file"
                        accept=".pdf,.docx,.png,.jpg,.jpeg,.figma,.zip"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            if (f.size > 20 * 1024 * 1024) {
                              setError('Файл не должен превышать 20 МБ');
                              return;
                            }
                            setSubmissionFile(f);
                          }
                        }}
                      />
                      + Прикрепить файл (PDF, DOCX, PNG — до 20 МБ)
                    </label>
                  )}
                </div>

                <p className="text-xs text-[var(--color-text-disabled)] italic mb-4">
                  После отправки потребуется подтверждение. Ответ нельзя изменить.
                </p>

                <div className="flex gap-3 justify-end">
                  <Button variant="secondary" size="sm" onClick={closeSubmissionForm}>
                    Отмена
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSubmit}
                    disabled={submitting || (isShort && !submissionText.trim())}
                  >
                    {submitting ? 'Отправка…' : 'Сдать задание →'}
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--color-text-tertiary)] transition-transform"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="10" height="13" rx="1" />
      <path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
    </svg>
  );
}
