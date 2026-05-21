'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner, Button, Badge, Select } from '@platform/ui/atoms';
import {
  getStudentAssignments,
  updateStudentAssignment,
  submitStudentAssignment,
  getStreams,
  type StudentAssignment,
  type Stream,
} from '@/lib/api';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',      href: '/dashboard',             icon: <GridIcon /> },
      { label: 'Уроки',      href: '/dashboard/lessons',     icon: <BookIcon /> },
      { label: 'Задания',    href: '/dashboard/assignments', icon: <ClipboardIcon /> },
      { label: 'Тред',       href: '/dashboard/thread',      icon: <ChatIcon /> },
      { label: 'Расписание', href: '/dashboard/schedule',    icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/dashboard/notifications', icon: <BellNavIcon /> },
      { label: 'Профиль',    href: '/dashboard/profile',     icon: <UserIcon /> },
    ],
  },
];

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
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submissionModalSaId, setSubmissionModalSaId] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

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
    if (!confirm('Отправить задание на проверку? Ответ нельзя изменить после отправки.')) return;
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (!user || user.role !== 'student') return null;

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
      <div style={{ padding: 'var(--space-6)', maxWidth: 900 }}>
        {/* Page header */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              marginBottom: 'var(--space-3)',
              padding: 0,
              transition: 'color var(--duration-fast) var(--ease-default)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M9 2L4 7l5 5" />
            </svg>
            Назад
          </button>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--font-semibold)',
            fontFamily: 'var(--font-sans)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--color-text-primary)',
          }}>
            Мои задания
          </h1>
          <p style={{
            margin: 'var(--space-1) 0 0',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
          }}>
            {assignments.length} задани{assignments.length === 1 ? 'е' : assignments.length < 5 ? 'я' : 'й'}
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-error-dim)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-xs)',
            marginBottom: 'var(--space-4)',
            color: 'var(--color-error)',
            fontSize: 'var(--text-sm)',
            display: 'flex',
            justifyContent: 'space-between',
            userSelect: 'text',
          }}>
            <span>{error}</span>
            <button
              onClick={() => setError('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 16 }}
            >
              ×
            </button>
          </div>
        )}

        {success && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-success-dim)',
            border: '1px solid var(--color-success)',
            borderRadius: 'var(--radius-xs)',
            marginBottom: 'var(--space-4)',
            color: 'var(--color-success)',
            fontSize: 'var(--text-sm)',
          }}>
            {success}
          </div>
        )}

        {/* Filters */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-5)',
          flexWrap: 'wrap',
        }}>
          <Select
            value={streamFilter}
            onChange={(e) => setStreamFilter(e.target.value)}
            fullWidth={false}
            style={{ minWidth: 160 }}
          >
            <option value="">Все потоки</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
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
              onClick={() => { setStreamFilter(''); setStatusFilter(''); }}
              style={{
                background: 'none',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--color-text-tertiary)',
                cursor: 'pointer',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: 'var(--tracking-wide)',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2L2 10" />
              </svg>
              Сбросить
            </button>
          )}
        </div>

        {/* Content */}
        {loadingData ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-16)' }}>
            <Spinner size="lg" />
          </div>
        ) : assignments.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-16)',
            border: '1px dashed var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-full)',
              border: '2px solid var(--color-border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-disabled)',
            }}>
              <ClipboardIcon />
            </div>
            <p style={{
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--text-sm)',
              margin: 0,
              fontFamily: 'var(--font-mono)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
            }}>
              {statusFilter || streamFilter ? 'Нет заданий по фильтрам' : 'Заданий пока нет'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {assignments.map((sa) => {
              const a = sa.assignment;
              const isExpanded = expandedId === sa.id;
              const isOverdue = a?.dueDate && new Date(a.dueDate) < new Date() && (sa.status === 'assigned' || sa.status === 'needs_revision');

              return (
                <div
                  key={sa.id}
                  style={{
                    border: `1px solid ${isOverdue ? 'var(--color-error)' : 'var(--color-border-default)'}`,
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    background: 'var(--color-bg-surface)',
                    transition: 'border-color var(--duration-fast) var(--ease-default)',
                  }}
                >
                  {/* Card header — clickable */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : sa.id)}
                    aria-expanded={isExpanded}
                    style={{
                      width: '100%',
                      padding: 'var(--space-4) var(--space-5)',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: isExpanded ? 'var(--color-bg-elevated)' : 'transparent',
                      border: 'none',
                      textAlign: 'left',
                      transition: 'background var(--duration-fast) var(--ease-default)',
                      gap: 'var(--space-4)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 'var(--font-medium)' as unknown as number,
                        fontSize: 'var(--text-base)',
                        fontFamily: 'var(--font-sans)',
                        color: 'var(--color-text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginBottom: 'var(--space-2)',
                      }}>
                        {a?.title}
                      </div>
                      <div style={{
                        display: 'flex',
                        gap: 'var(--space-2)',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}>
                        <Badge variant={STATUS_VARIANT[sa.status] ?? 'default'}>
                          {STATUS_LABELS[sa.status]}
                        </Badge>
                        {a?.type && (
                          <Badge variant="default">{TYPE_LABELS[a.type] ?? a.type}</Badge>
                        )}
                        {a && !a.groupId && (
                          <Badge variant="accent">Индивидуальное</Badge>
                        )}
                        {a?.stream && (
                          <span style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-tertiary)',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: 'var(--tracking-wide)',
                          }}>
                            {a.stream.name}
                          </span>
                        )}
                        {a?.lesson && (
                          <span style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-disabled)',
                          }}>
                            Урок: {a.lesson.title}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{
                      display: 'flex',
                      gap: 'var(--space-4)',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}>
                      {a?.dueDate && (
                        <div style={{
                          textAlign: 'right',
                          fontSize: 'var(--text-xs)',
                        }}>
                          <div style={{
                            color: 'var(--color-text-disabled)',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: 'var(--tracking-wide)',
                            textTransform: 'uppercase',
                            marginBottom: 2,
                          }}>
                            Дедлайн
                          </div>
                          <div style={{
                            color: isOverdue ? 'var(--color-error)' : 'var(--color-text-secondary)',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: isOverdue ? 'var(--font-semibold)' as unknown as number : undefined,
                          }}>
                            {new Date(a.dueDate).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                          </div>
                        </div>
                      )}
                      <ChevronIcon open={isExpanded} />
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{
                      padding: 'var(--space-4) var(--space-5)',
                      borderTop: '1px solid var(--color-border-subtle)',
                    }}>
                      {a?.description ? (
                        <div style={{ marginBottom: 'var(--space-4)' }}>
                          <p style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-tertiary)',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: 'var(--tracking-wide)',
                            textTransform: 'uppercase',
                            marginBottom: 'var(--space-2)',
                          }}>
                            Описание
                          </p>
                          <p style={{
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                            fontSize: 'var(--text-sm)',
                            lineHeight: 'var(--leading-relaxed)',
                            color: 'var(--color-text-secondary)',
                          }}>
                            {a.description}
                          </p>
                        </div>
                      ) : (
                        <p style={{
                          color: 'var(--color-text-disabled)',
                          fontSize: 'var(--text-sm)',
                          fontStyle: 'italic',
                          marginBottom: 'var(--space-4)',
                        }}>
                          Описание не указано
                        </p>
                      )}

                      {a?.tags && a.tags.length > 0 && (
                        <div style={{
                          display: 'flex',
                          gap: 'var(--space-1)',
                          flexWrap: 'wrap',
                          marginBottom: 'var(--space-4)',
                        }}>
                          {a.tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: 'var(--text-xs)',
                                background: 'var(--color-bg-overlay)',
                                color: 'var(--color-text-tertiary)',
                                padding: 'var(--space-1) var(--space-2)',
                                borderRadius: 'var(--radius-full)',
                                border: '1px solid var(--color-border-subtle)',
                                fontFamily: 'var(--font-mono)',
                                letterSpacing: 'var(--tracking-wide)',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Submitted answer display */}
                      {(sa.status === 'submitted' || sa.status === 'reviewed') && sa.content && (
                        <div style={{
                          marginBottom: 'var(--space-4)',
                          padding: 'var(--space-3) var(--space-4)',
                          background: 'var(--color-bg-overlay)',
                          borderLeft: '3px solid var(--color-info)',
                          borderRadius: 'var(--radius-xs)',
                        }}>
                          <p style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-tertiary)',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: 'var(--tracking-wide)',
                            textTransform: 'uppercase',
                            marginBottom: 'var(--space-2)',
                          }}>
                            Ваш ответ
                          </p>
                          <p style={{
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                            fontSize: 'var(--text-sm)',
                            lineHeight: 'var(--leading-relaxed)',
                            color: 'var(--color-text-secondary)',
                            fontStyle: 'italic',
                          }}>
                            {sa.content}
                          </p>
                        </div>
                      )}

                      {(sa.status === 'submitted' || sa.status === 'reviewed') && sa.fileName && (
                        <div style={{
                          marginBottom: 'var(--space-4)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-3)',
                          padding: 'var(--space-2) var(--space-3)',
                          background: 'var(--color-bg-overlay)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--color-border-subtle)',
                        }}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z" />
                            <path d="M9 1v4h4" />
                          </svg>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 'var(--text-sm)',
                              color: 'var(--color-text-primary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {sa.fileName}
                            </div>
                            {sa.fileSize && (
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-disabled)' }}>
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
                              style={{
                                fontSize: 'var(--text-xs)',
                                color: 'var(--color-info)',
                                textDecoration: 'none',
                              }}
                            >
                              Открыть ↗
                            </a>
                          )}
                        </div>
                      )}

                      <div style={{
                        display: 'flex',
                        gap: 'var(--space-5)',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                      }}>
                        <div style={{
                          display: 'flex',
                          gap: 'var(--space-5)',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-text-disabled)',
                          fontFamily: 'var(--font-mono)',
                          letterSpacing: 'var(--tracking-wide)',
                        }}>
                          {sa.submittedAt && (
                            <span>Отправлено: {new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          )}
                          {sa.reviewedAt && (
                            <span>Проверено: {new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <button
                            onClick={() => router.push(
                              `/dashboard/thread?assignmentId=${a?.id}&title=${encodeURIComponent(a?.title || '')}`
                            )}
                            style={{
                              background: 'none',
                              border: '1px solid var(--color-info)',
                              borderRadius: 'var(--radius-xs)',
                              color: 'var(--color-info)',
                              cursor: 'pointer',
                              padding: 'var(--space-2) var(--space-3)',
                              fontSize: 'var(--text-xs)',
                              fontFamily: 'var(--font-sans)',
                              fontWeight: 'var(--font-medium)' as unknown as number,
                              letterSpacing: 'var(--tracking-wide)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--space-1)',
                              transition: 'background var(--duration-fast) var(--ease-default)',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(77,166,255,0.08)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
                              {sa.status === 'needs_revision' ? 'Пересдать' : 'Отправить на проверку'}
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

      {/* Submission Form Modal */}
      {submissionModalSaId && (() => {
        const modalSa = assignments.find((s) => s.id === submissionModalSaId);
        const modalAssignment = modalSa?.assignment;
        const isShort = modalAssignment?.type === 'short';

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: 'var(--space-4)',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) closeSubmissionForm(); }}
          >
            <div style={{
              background: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border-default)',
              width: '100%',
              maxWidth: 520,
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 'var(--space-6)',
            }}>
              {/* Context banner */}
              <div style={{
                marginBottom: 'var(--space-5)',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-bg-elevated)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-subtle)',
              }}>
                <div style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-disabled)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: 'var(--tracking-wide)',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-1)',
                }}>
                  Сдача задания
                </div>
                <div style={{
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--font-medium)' as unknown as number,
                  color: 'var(--color-text-primary)',
                }}>
                  {modalAssignment?.title}
                </div>
                <div style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-2)',
                }}>
                  {modalAssignment?.type && (
                    <Badge variant="default">{TYPE_LABELS[modalAssignment.type] ?? modalAssignment.type}</Badge>
                  )}
                  {modalAssignment?.dueDate && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                      Дедлайн: {new Date(modalAssignment.dueDate).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Answer textarea */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{
                  display: 'block',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: 'var(--tracking-wide)',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-2)',
                }}>
                  Ваш ответ {isShort && <span style={{ color: 'var(--color-error)' }}>*</span>}
                </label>
                <textarea
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  placeholder="Опишите вашу работу кратко…"
                  maxLength={2000}
                  style={{
                    width: '100%',
                    minHeight: 140,
                    resize: 'none',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-default)',
                    background: 'var(--color-bg-input)',
                    color: 'var(--color-text-primary)',
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'var(--font-sans)',
                    lineHeight: 'var(--leading-relaxed)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{
                  textAlign: 'right',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-disabled)',
                  marginTop: 'var(--space-1)',
                }}>
                  {submissionText.length} / 2000
                </div>
              </div>

              {/* File upload */}
              <div style={{ marginBottom: 'var(--space-5)' }}>
                <label style={{
                  display: 'block',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: 'var(--tracking-wide)',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-2)',
                }}>
                  Файл
                </label>
                {submissionFile ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--color-bg-overlay)',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--color-border-subtle)',
                  }}>
                    <Badge variant="default">
                      {submissionFile.name.split('.').pop()?.toUpperCase()}
                    </Badge>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 'var(--text-sm)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {submissionFile.name}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-disabled)' }}>
                        {submissionFile.size < 1024 * 1024
                          ? `${Math.round(submissionFile.size / 1024)} КБ`
                          : `${(submissionFile.size / (1024 * 1024)).toFixed(1)} МБ`}
                      </div>
                    </div>
                    <button
                      onClick={() => setSubmissionFile(null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-disabled)',
                        fontSize: 'var(--text-base)',
                        padding: 'var(--space-1)',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-4)',
                    border: '2px dashed var(--color-border-default)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-tertiary)',
                    transition: 'border-color var(--duration-fast) var(--ease-default)',
                  }}>
                    <input
                      type="file"
                      accept=".pdf,.docx,.png,.jpg,.jpeg,.figma,.zip"
                      style={{ display: 'none' }}
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

              {/* Hint */}
              <p style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-disabled)',
                fontStyle: 'italic',
                marginBottom: 'var(--space-4)',
              }}>
                После отправки потребуется подтверждение. Ответ нельзя изменить.
              </p>

              {/* Actions */}
              <div style={{
                display: 'flex',
                gap: 'var(--space-3)',
                justifyContent: 'flex-end',
              }}>
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
    </DashboardLayout>
  );
}

/* ─── Icons ─── */

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
      style={{
        color: 'var(--color-text-tertiary)',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform var(--duration-fast) var(--ease-default)',
      }}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h10v12H3z" /><path d="M6 2v12" /><path d="M6 5h4M6 8h4M6 11h4" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="10" height="13" rx="1" />
      <path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h12v9H5l-3 3V2z" /><path d="M5 6h6M5 9h3" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" /><path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" /><path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}

function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}
