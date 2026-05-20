'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',      href: '/admin',           icon: <GridIcon /> },
      { label: 'Ученики',    href: '/admin/students',  icon: <UsersIcon /> },
      { label: 'Потоки',     href: '/admin/streams',   icon: <StreamIcon /> },
      { label: 'Расписание', href: '/admin/schedule',  icon: <CalendarIcon /> },
    ],
  },
];
import {
  getThread,
  addThreadEntry,
  uploadThreadFile,
  type ThreadEntry,
  type ThreadEntryType,
} from '@/lib/api';

/* ─── Inline SVG icons for compose bar ──────────────────── */

function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 9.25l-7.72 7.72a4.25 4.25 0 01-6.01-6.01L11.5 3.24a2.83 2.83 0 014 4L7.78 14.96a1.42 1.42 0 01-2-2l7.22-7.22" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3h12v14H4z" />
      <path d="M7 7h6M7 10h6M7 13h3" />
      <path d="M4 3h12" strokeDasharray="2 2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10l14-7-7 14v-7H3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export default function AdminStudentThreadPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const studentId = params.id as string;

  const [studentName, setStudentName] = useState('');
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  // Input state
  const [inputMode, setInputMode] = useState<'comment' | 'note'>('comment');
  const [content, setContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchThread = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingData(true);
    try {
      const data = await getThread(accessToken, studentId);
      setStudentName(data.student.name);
      setEntries(data.entries);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки треда');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, studentId]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchThread();
    }
  }, [accessToken, user, fetchThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleSend = async () => {
    if (!accessToken || !content.trim()) return;
    setSending(true);
    try {
      const { entry } = await addThreadEntry(accessToken, studentId, {
        type: inputMode as ThreadEntryType,
        content: content.trim(),
      });
      setEntries((prev) => [...prev, entry]);
      setContent('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;

    if (file.size > 50 * 1024 * 1024) {
      setError('Файл превышает максимальный размер 50MB');
      return;
    }

    setSending(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, studentId, file, 'file');
      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (!user || user.role !== 'admin') return null;

  const hasContent = content.trim().length > 0;

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => { await logout(); router.push('/login'); },
        platformName: 'PLATFORM ADMIN',
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - var(--header-height))',
      maxWidth: 800,
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--space-4) var(--space-4) var(--space-3)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <button
          onClick={() => router.push('/admin/students')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-tertiary)',
            marginBottom: 'var(--space-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            fontFamily: 'var(--font-sans)',
            transition: 'color var(--duration-fast) var(--ease-default)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2L4 7l5 5" />
          </svg>
          К списку учеников
        </button>
        <h1 style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 'var(--font-semibold)',
          fontFamily: 'var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)',
          margin: 0,
          color: 'var(--color-text-primary)',
        }}>
          {studentName || 'Загрузка...'}
        </h1>
        <p style={{
          color: 'var(--color-text-tertiary)',
          margin: 'var(--space-1) 0 0',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: 'var(--tracking-wide)',
          textTransform: 'uppercase',
        }}>Тред ученика</p>
      </div>

      {/* Error toast */}
      {error && (
        <div style={{
          margin: 'var(--space-3) var(--space-4) 0',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-error-dim)',
          border: '1px solid var(--color-error)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-error)',
          fontSize: 'var(--text-sm)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-error)',
              padding: 'var(--space-1)',
              display: 'flex',
            }}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}>
        {loadingData ? (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Spinner size="lg" />
          </div>
        ) : entries.length === 0 ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
          }}>
            <p style={{
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
            }}>
              Тред пуст
            </p>
          </div>
        ) : (
          entries.map((entry, i) => (
            <AdminMessageBubble
              key={entry.id}
              entry={entry}
              showAuthor={i === 0 || entries[i - 1].authorId !== entry.authorId}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* ─── Compose bar ─── */}
      <div style={{
        borderTop: '1px solid var(--color-border-subtle)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-bg-surface)',
      }}>
        {/* Note mode indicator */}
        {inputMode === 'note' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-2) var(--space-3)',
            marginBottom: 'var(--space-2)',
            background: 'var(--color-warning-dim)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <span style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-warning)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
            }}>
              Приватная заметка — ученик не увидит
            </span>
            <button
              onClick={() => setInputMode('comment')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-warning)',
                padding: 'var(--space-1)',
                display: 'flex',
              }}
            >
              <CloseIcon />
            </button>
          </div>
        )}

        {/* Main compose row */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--space-2)',
        }}>
          {/* Action icons */}
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <IconButton
              title="Прикрепить файл"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
            >
              <PaperclipIcon />
            </IconButton>

            <IconButton
              title="Приватная заметка"
              active={inputMode === 'note'}
              onClick={() => setInputMode(inputMode === 'note' ? 'comment' : 'note')}
              accent={inputMode === 'note'}
            >
              <NoteIcon />
            </IconButton>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaChange}
            placeholder={inputMode === 'comment' ? 'Комментарий для ученика...' : 'Приватная заметка...'}
            rows={1}
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-lg)',
              border: `1px solid ${inputMode === 'note' ? 'var(--color-warning)' : 'var(--color-border-default)'}`,
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              background: inputMode === 'note' ? 'var(--color-warning-dim)' : 'var(--color-bg-elevated)',
              color: 'var(--color-text-primary)',
              resize: 'none',
              overflow: 'hidden',
              lineHeight: 'var(--leading-normal)',
              outline: 'none',
              minHeight: 36,
              maxHeight: 160,
              transition: 'border-color var(--duration-fast) var(--ease-default), background var(--duration-fast) var(--ease-default)',
            }}
            onFocus={(e) => {
              if (inputMode !== 'note') e.target.style.borderColor = 'var(--color-accent-red)';
            }}
            onBlur={(e) => {
              if (inputMode !== 'note') e.target.style.borderColor = 'var(--color-border-default)';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />

          {/* Send button */}
          <button
            disabled={sending || !hasContent}
            onClick={handleSend}
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: hasContent ? 'var(--color-accent-red)' : 'var(--color-bg-elevated)',
              color: hasContent ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
              cursor: hasContent ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
            }}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
    </DashboardLayout>
  );
}

/* ─── Icon button for compose bar ─── */

function IconButton({
  children,
  title,
  onClick,
  disabled,
  active,
  accent,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 36,
        height: 36,
        borderRadius: 'var(--radius-full)',
        border: 'none',
        background: active
          ? accent
            ? 'var(--color-warning-dim)'
            : 'var(--color-bg-overlay)'
          : 'transparent',
        color: accent
          ? 'var(--color-warning)'
          : active
            ? 'var(--color-text-primary)'
            : 'var(--color-text-tertiary)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        opacity: disabled ? 0.38 : 1,
        transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.background = 'var(--color-bg-overlay)';
          e.currentTarget.style.color = 'var(--color-text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--color-text-tertiary)';
        }
      }}
    >
      {children}
    </button>
  );
}

/* ─── Nav icons ─── */

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" />
      <rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" />
      <rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" />
      <path d="M15 13c0-2-1-4-3-4" />
    </svg>
  );
}

function StreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h10" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" />
      <path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}

/* ─── Chat message bubble (admin view) ─── */

function AdminMessageBubble({
  entry,
  showAuthor,
}: {
  entry: ThreadEntry;
  showAuthor: boolean;
}) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);

  const initials = entry.author.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isAdmin ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 'var(--space-2)',
        marginTop: showAuthor ? 'var(--space-4)' : 'var(--space-1)',
        maxWidth: '85%',
        alignSelf: isAdmin ? 'flex-end' : 'flex-start',
      }}
    >
      {/* Avatar */}
      {showAuthor ? (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-full)',
            background: isNote
              ? 'var(--color-warning-dim)'
              : isAdmin
                ? 'var(--color-accent-red-dim)'
                : 'var(--color-bg-overlay)',
            border: `1px solid ${
              isNote
                ? 'var(--color-warning)'
                : isAdmin
                  ? 'var(--color-accent-red)'
                  : 'var(--color-border-default)'
            }`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-bold)',
            color: isNote
              ? 'var(--color-warning)'
              : isAdmin
                ? 'var(--color-accent-red)'
                : 'var(--color-text-secondary)',
            flexShrink: 0,
            letterSpacing: 'var(--tracking-wide)',
          }}
        >
          {initials}
        </div>
      ) : (
        <div style={{ width: 32, flexShrink: 0 }} />
      )}

      {/* Bubble */}
      <div style={{ minWidth: 0 }}>
        {showAuthor && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: isNote
                ? 'var(--color-warning)'
                : isAdmin
                  ? 'var(--color-accent-red)'
                  : 'var(--color-text-tertiary)',
              marginBottom: 'var(--space-1)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
              textAlign: isAdmin ? 'right' : 'left',
              paddingLeft: isAdmin ? 0 : 'var(--space-2)',
              paddingRight: isAdmin ? 'var(--space-2)' : 0,
            }}
          >
            {entry.author.name}
            {isNote && (
              <span style={{ marginLeft: 'var(--space-2)', color: 'var(--color-warning)' }}>
                заметка
              </span>
            )}
          </div>
        )}

        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: isAdmin
              ? 'var(--radius-xl) var(--radius-xl) var(--radius-xs) var(--radius-xl)'
              : 'var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-xs)',
            background: isNote
              ? 'var(--color-warning-dim)'
              : isAdmin
                ? 'var(--color-bg-overlay)'
                : 'var(--color-bg-elevated)',
            border: `1px solid ${
              isNote
                ? 'var(--color-warning)'
                : 'var(--color-border-default)'
            }`,
            ...(isNote && {
              borderStyle: 'dashed' as const,
            }),
          }}
        >
          <div style={{
            fontSize: 'var(--text-sm)',
            lineHeight: 'var(--leading-normal)',
            color: 'var(--color-text-primary)',
            wordBreak: 'break-word',
          }}>
            {['text', 'comment', 'note'].includes(entry.type) ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</span>
            ) : entry.type === 'link' ? (
              <div>
                {entry.content.includes('\n') ? (
                  <>
                    <div style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-secondary)',
                      marginBottom: 'var(--space-1)',
                    }}>
                      {entry.content.split('\n')[0]}
                    </div>
                    <a
                      href={entry.content.split('\n')[1]}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--color-info)',
                        wordBreak: 'break-all',
                        fontSize: 'var(--text-sm)',
                        textDecoration: 'none',
                        borderBottom: '1px solid var(--color-info)',
                      }}
                    >
                      {entry.content.split('\n')[1]}
                    </a>
                  </>
                ) : (
                  <a
                    href={entry.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--color-info)',
                      wordBreak: 'break-all',
                      textDecoration: 'none',
                      borderBottom: '1px solid var(--color-info)',
                    }}
                  >
                    {entry.content}
                  </a>
                )}
              </div>
            ) : entry.type === 'file' ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-overlay)',
                  border: '1px solid var(--color-border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: 'var(--color-text-tertiary)',
                }}>
                  <PaperclipIcon />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--font-medium)' as unknown as number,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {entry.metadata?.fileName || entry.content}
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: 'var(--space-3)',
                    alignItems: 'center',
                  }}>
                    {entry.metadata?.size && (
                      <span style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-tertiary)',
                      }}>
                        {(entry.metadata.size / 1024 / 1024).toFixed(1)} МБ
                      </span>
                    )}
                    {entry.metadata?.url && (
                      <a
                        href={entry.metadata.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-info)',
                          textDecoration: 'none',
                          fontFamily: 'var(--font-mono)',
                          letterSpacing: 'var(--tracking-wide)',
                          textTransform: 'uppercase',
                        }}
                      >
                        Скачать
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : entry.type === 'audio' ? (
              <div>
                {entry.metadata?.url ? (
                  <audio
                    controls
                    src={entry.metadata.url}
                    style={{
                      maxWidth: '100%',
                      height: 36,
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                ) : (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>Аудиозапись</span>
                )}
              </div>
            ) : null}
          </div>

          <div style={{
            fontSize: '10px',
            color: 'var(--color-text-disabled)',
            marginTop: 'var(--space-1)',
            textAlign: isAdmin ? 'left' : 'right',
            fontFamily: 'var(--font-mono)',
            letterSpacing: 'var(--tracking-wide)',
          }}>
            {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {entry.assignment && (
          <div style={{
            marginTop: 'var(--space-1)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-disabled)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: 'var(--tracking-wide)',
            paddingLeft: 'var(--space-2)',
            paddingRight: 'var(--space-2)',
          }}>
            К заданию: {entry.assignment.title}
          </div>
        )}
      </div>
    </div>
  );
}
