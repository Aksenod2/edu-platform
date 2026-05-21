'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { STUDENT_NAV } from '@/lib/student-nav';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner, Button, Badge } from '@platform/ui/atoms';
import {
  getStudentAssignments,
  submitStudentAssignment,
  getThread,
  type StudentAssignment,
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

export default function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [sa, setSa] = useState<StudentAssignment | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [feedback, setFeedback] = useState<ThreadEntry | null | undefined>(undefined);

  const [submissionText, setSubmissionText] = useState('');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchAssignment = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const data = await getStudentAssignments(accessToken);
      const found = data.studentAssignments.find((item) => item.id === id);
      if (!found) {
        setError('Задание не найдено');
      } else {
        setSa(found);
        setError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, id]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') fetchAssignment();
  }, [accessToken, user, fetchAssignment]);

  const loadFeedback = useCallback(async () => {
    if (!accessToken || !user || !sa?.assignment?.id) return;
    try {
      const data = await getThread(accessToken, user.id, sa.assignment.id);
      const adminComments = data.entries.filter(
        (e) => e.type === 'comment' && e.author.role === 'admin' && e.assignmentId === sa.assignment?.id,
      );
      setFeedback(adminComments.length > 0 ? adminComments[adminComments.length - 1] : null);
    } catch {
      setFeedback(null);
    }
  }, [accessToken, user, sa]);

  useEffect(() => {
    if (sa?.status === 'reviewed') loadFeedback();
  }, [sa, loadFeedback]);

  const handleSubmit = async () => {
    if (!accessToken || !sa) return;
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const updated = await submitStudentAssignment(accessToken, sa.id, {
        answerText: submissionText || undefined,
        file: submissionFile || undefined,
      });
      setSa(updated.studentAssignment);
      setSuccess('Задание отправлено на проверку');
      setShowForm(false);
      setSubmissionText('');
      setSubmissionFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || loadingData) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || user.role !== 'student') return null;

  const a = sa?.assignment;
  const isOverdue = sa && a?.dueDate && new Date(a.dueDate) < new Date() && (sa.status === 'assigned' || sa.status === 'needs_revision');
  const isShort = a?.type === 'short';

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'student' },
        onLogout: async () => { await logout(); router.push('/login'); },
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: STUDENT_NAV }}
    >
      <div className="max-w-2xl">
        {/* Back */}
        <Link
          href="/dashboard/assignments"
          className="inline-flex items-center gap-1 font-mono text-xs tracking-wide text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors mb-6 no-underline"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M9 2L4 7l5 5" />
          </svg>
          К заданиям
        </Link>

        {error && !sa && (
          <div className="px-4 py-3 border border-[var(--color-error)] bg-[var(--color-error-dim)] text-[var(--color-error)] text-sm mb-6">
            {error}
          </div>
        )}

        {sa && (
          <>
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-start gap-3 mb-3 flex-wrap">
                <Badge variant={STATUS_VARIANT[sa.status] ?? 'default'}>
                  {STATUS_LABELS[sa.status]}
                </Badge>
                {a?.type && <Badge variant="default">{TYPE_LABELS[a.type] ?? a.type}</Badge>}
                {a && !a.groupId && <Badge variant="accent">Индивидуальное</Badge>}
              </div>
              <h1 className="font-sans text-2xl font-semibold tracking-tight text-[var(--color-text-primary)] mb-2">
                {a?.title ?? '—'}
              </h1>
              <div className="flex gap-4 flex-wrap">
                {a?.stream && (
                  <span className="font-mono text-xs tracking-wide text-[var(--color-text-tertiary)] uppercase">
                    {a.stream.name}
                  </span>
                )}
                {a?.lesson && (
                  <span className="font-mono text-xs tracking-wide text-[var(--color-text-disabled)]">
                    Урок: {a.lesson.title}
                  </span>
                )}
              </div>
            </div>

            {/* Meta row */}
            {a?.dueDate && (
              <div className="flex items-center gap-3 mb-6 p-3 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-[var(--color-text-tertiary)] shrink-0">
                  <rect x="1" y="2" width="12" height="11" rx="1" />
                  <path d="M1 6h12M4 1v2M10 1v2" />
                </svg>
                <div className="font-mono text-xs tracking-wide">
                  <span className="text-[var(--color-text-disabled)] uppercase mr-2">Дедлайн</span>
                  <span style={{ color: isOverdue ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                    {new Date(a.dueDate).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}
                  </span>
                  {isOverdue && (
                    <span className="ml-2 text-[var(--color-error)] uppercase font-bold">— просрочено</span>
                  )}
                </div>
              </div>
            )}

            {/* Description */}
            {a?.description ? (
              <section className="mb-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-3">
                  Описание
                </h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)] m-0">
                  {a.description}
                </p>
              </section>
            ) : (
              <section className="mb-6">
                <p className="text-sm text-[var(--color-text-disabled)] italic">Описание не указано</p>
              </section>
            )}

            {/* Materials */}
            {a?.materials && a.materials.length > 0 && (
              <section className="mb-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-3">
                  Материалы
                </h2>
                <div className="flex flex-col gap-2">
                  {a.materials.map((m, i) => (
                    <a
                      key={i}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={m.type === 'file' ? m.name : undefined}
                      className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] text-[var(--color-accent)] no-underline text-sm hover:opacity-80 transition-opacity"
                    >
                      {m.type === 'file' ? (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M8 1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z" />
                          <path d="M8 1v4h4M5 9l2 2 2-2M7 11V6" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M6 3H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" />
                          <path d="M9 1h4v4M14 1L7 8" />
                        </svg>
                      )}
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{m.name}</span>
                      {m.type === 'file' && m.size && (
                        <span className="font-mono text-xs text-[var(--color-text-disabled)] shrink-0">
                          {Math.round(m.size / 1024)}KB
                        </span>
                      )}
                      <span className="font-mono text-xs text-[var(--color-text-disabled)] shrink-0 uppercase">
                        {m.type === 'file' ? 'Скачать' : 'Открыть'}
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Tags */}
            {a?.tags && a.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mb-6">
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

            {/* Divider */}
            <div className="border-t border-[var(--color-border-subtle)] my-6" />

            {/* Submitted answer */}
            {(sa.status === 'submitted' || sa.status === 'reviewed') && (
              <section className="mb-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-3">
                  Ваш ответ
                </h2>
                {sa.content && (
                  <div className="px-4 py-3 bg-[var(--color-bg-overlay)] border-l-[3px] border-[var(--color-info)] mb-3">
                    <p className="whitespace-pre-wrap m-0 text-sm leading-relaxed text-[var(--color-text-secondary)] italic">
                      {sa.content}
                    </p>
                  </div>
                )}
                {sa.fileName && (
                  <div className="flex items-center gap-3 px-3 py-2 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)]">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-tertiary)]">
                      <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z" />
                      <path d="M9 1v4h4" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--color-text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
                        {sa.fileName}
                      </div>
                      {sa.fileSize && (
                        <div className="font-mono text-xs text-[var(--color-text-disabled)]">
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
                        className="font-mono text-xs text-[var(--color-info)] no-underline"
                      >
                        Открыть ↗
                      </a>
                    )}
                  </div>
                )}
                {sa.submittedAt && (
                  <p className="font-mono text-xs text-[var(--color-text-disabled)] tracking-wide mt-2">
                    Отправлено: {new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}
                  </p>
                )}
              </section>
            )}

            {/* Teacher feedback */}
            {sa.status === 'reviewed' && feedback && (
              <section className="mb-6">
                <div className="p-4 border border-[rgba(57,255,20,0.2)] bg-[rgba(57,255,20,0.04)]">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-success)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 2h10v7H5l-3 3V2z"/>
                      <path d="M4.5 5h5M4.5 7.5h3"/>
                    </svg>
                    <span className="font-mono text-xs tracking-widest uppercase text-[var(--color-success)]">
                      Фидбек учителя
                    </span>
                    <span className="font-mono text-xs text-[var(--color-text-disabled)] ml-auto">
                      {new Date(feedback.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · {feedback.author.name}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap m-0">
                    {feedback.content}
                  </p>
                  {sa.reviewedAt && (
                    <p className="font-mono text-xs text-[var(--color-text-disabled)] mt-3 tracking-wide">
                      Проверено: {new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* Alerts */}
            {error && (
              <div className="flex justify-between items-center px-4 py-3 mb-4 border border-[var(--color-error)] bg-[var(--color-error-dim)] text-[var(--color-error)] text-sm">
                <span>{error}</span>
                <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-[var(--color-error)] text-base leading-none">×</button>
              </div>
            )}
            {success && (
              <div className="px-4 py-3 mb-4 border border-[var(--color-success)] bg-[var(--color-success-dim)] text-[var(--color-success)] text-sm">
                {success}
              </div>
            )}

            {/* Submission form */}
            {(sa.status === 'assigned' || sa.status === 'needs_revision') && !showForm && (
              <div className="flex gap-3">
                <Button variant="primary" onClick={() => setShowForm(true)}>
                  {sa.status === 'needs_revision' ? 'Пересдать задание' : 'Сдать задание'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/dashboard/thread?assignmentId=${a?.id}&title=${encodeURIComponent(a?.title || '')}`)}
                >
                  Задать вопрос
                </Button>
              </div>
            )}

            {showForm && (
              <section>
                <h2 className="font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-4">
                  {sa.status === 'needs_revision' ? 'Пересдача задания' : 'Сдача задания'}
                </h2>

                {/* Answer */}
                <div className="mb-4">
                  <label className="block font-mono text-xs tracking-widest uppercase text-[var(--color-text-tertiary)] mb-2">
                    Ваш ответ {isShort && <span className="text-[var(--color-error)]">*</span>}
                  </label>
                  <textarea
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    placeholder="Опишите вашу работу кратко…"
                    maxLength={2000}
                    className="w-full min-h-[160px] resize-none p-3 border border-[var(--color-border-default)] bg-[var(--color-bg-input)] text-[var(--color-text-primary)] text-sm font-sans leading-relaxed outline-none focus:border-[var(--color-border-strong)] box-border"
                  />
                  <div className="text-right font-mono text-xs text-[var(--color-text-disabled)] mt-1">
                    {submissionText.length} / 2000
                  </div>
                </div>

                {/* File */}
                <div className="mb-6">
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
                        <div className="font-mono text-xs text-[var(--color-text-disabled)]">
                          {submissionFile.size < 1024 * 1024
                            ? `${Math.round(submissionFile.size / 1024)} КБ`
                            : `${(submissionFile.size / (1024 * 1024)).toFixed(1)} МБ`}
                        </div>
                      </div>
                      <button
                        onClick={() => setSubmissionFile(null)}
                        className="bg-transparent border-0 cursor-pointer text-[var(--color-text-disabled)] text-base p-1 hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 p-6 border-2 border-dashed border-[var(--color-border-default)] cursor-pointer text-sm text-[var(--color-text-tertiary)] hover:border-[var(--color-border-strong)] transition-colors">
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
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M8 2v8M5 5l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M2 12h12" strokeLinecap="round" />
                      </svg>
                      Прикрепить файл (PDF, DOCX, PNG — до 20 МБ)
                    </label>
                  )}
                </div>

                <p className="font-mono text-xs text-[var(--color-text-disabled)] italic mb-4">
                  После отправки ответ нельзя изменить.
                </p>

                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={submitting || (isShort && !submissionText.trim())}
                  >
                    {submitting ? 'Отправка…' : 'Сдать задание →'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowForm(false);
                      setSubmissionText('');
                      setSubmissionFile(null);
                    }}
                  >
                    Отмена
                  </Button>
                </div>
              </section>
            )}

            {/* Thread link */}
            {(sa.status === 'submitted' || sa.status === 'reviewed') && (
              <div className="mt-6 pt-6 border-t border-[var(--color-border-subtle)]">
                <button
                  onClick={() => router.push(`/dashboard/thread?assignmentId=${a?.id}&title=${encodeURIComponent(a?.title || '')}`)}
                  className="font-mono text-xs tracking-widest uppercase text-[var(--color-info)] bg-transparent border-0 cursor-pointer flex items-center gap-2 p-0 hover:opacity-80 transition-opacity"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 2h10v7H5l-3 3V2z"/>
                    <path d="M4.5 5h5M4.5 7.5h3"/>
                  </svg>
                  Открыть тред для этого задания
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
