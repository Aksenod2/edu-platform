'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';

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

function LinkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 11.5a4 4 0 005.66 0l2.5-2.5a4 4 0 00-5.66-5.66l-1.25 1.25" />
      <path d="M11.5 8.5a4 4 0 00-5.66 0l-2.5 2.5a4 4 0 005.66 5.66l1.25-1.25" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="6" height="10" rx="3" />
      <path d="M4 10a6 6 0 0012 0" />
      <path d="M10 16v2M7 18h6" />
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

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="3" width="10" height="10" rx="2" />
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

export default function StudentThreadPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  // Input state — always text; overlays for link/file/audio
  const [textContent, setTextContent] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchThread = useCallback(async () => {
    if (!accessToken || !user) return;
    setLoadingData(true);
    try {
      const data = await getThread(accessToken, user.id);
      setEntries(data.entries);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки треда');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') {
      fetchThread();
    }
  }, [accessToken, user, fetchThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextContent(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleSendText = async () => {
    if (!accessToken || !user || !textContent.trim()) return;
    setSending(true);
    try {
      const { entry } = await addThreadEntry(accessToken, user.id, {
        type: 'text',
        content: textContent.trim(),
      });
      setEntries((prev) => [...prev, entry]);
      setTextContent('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleSendLink = async () => {
    if (!accessToken || !user || !linkUrl.trim()) return;
    setSending(true);
    try {
      const { entry } = await addThreadEntry(accessToken, user.id, {
        type: 'link',
        content: linkUrl.trim(),
        ...(linkTitle.trim() ? { metadata: { title: linkTitle.trim() } } : {}),
      });
      setEntries((prev) => [...prev, entry]);
      setLinkUrl('');
      setLinkTitle('');
      setShowLinkInput(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken || !user) return;

    if (file.size > 50 * 1024 * 1024) {
      setError('Файл превышает максимальный размер 50MB');
      return;
    }

    setSending(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, user.id, file, 'file');
      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      setError('Нет доступа к микрофону');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const sendAudio = async () => {
    if (!audioBlob || !accessToken || !user) return;
    setSending(true);
    try {
      const file = new File([audioBlob], `audio-${Date.now()}.webm`, { type: 'audio/webm' });
      const { entry } = await uploadThreadFile(accessToken, user.id, file, 'audio');
      setEntries((prev) => [...prev, entry]);
      setAudioBlob(null);
      setRecordingTime(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки аудио');
    } finally {
      setSending(false);
    }
  };

  const cancelAudio = () => {
    setAudioBlob(null);
    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (!user || user.role !== 'student') return null;

  const hasText = textContent.trim().length > 0;

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
          onClick={() => router.push('/dashboard')}
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
          Назад
        </button>
        <h1 style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 'var(--font-semibold)',
          fontFamily: 'var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)',
          margin: 0,
          color: 'var(--color-text-primary)',
        }}>Мой тред</h1>
        <p style={{
          color: 'var(--color-text-tertiary)',
          margin: 'var(--space-1) 0 0',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: 'var(--tracking-wide)',
          textTransform: 'uppercase',
        }}>Записи · файлы · обратная связь</p>
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

      {/* Messages area — fills available space */}
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
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-full)',
              border: '2px solid var(--color-border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-tertiary)',
            }}>
              <ChatIcon />
            </div>
            <p style={{
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
            }}>
              Тред пуст
            </p>
            <p style={{
              color: 'var(--color-text-disabled)',
              fontSize: 'var(--text-sm)',
            }}>
              Напишите первое сообщение
            </p>
          </div>
        ) : (
          entries.map((entry, i) => (
            <MessageBubble
              key={entry.id}
              entry={entry}
              currentUserId={user.id}
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
        {/* Link inline panel */}
        {showLinkInput && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border-default)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-tertiary)',
                letterSpacing: 'var(--tracking-wide)',
                textTransform: 'uppercase',
              }}>Добавить ссылку</span>
              <button
                onClick={() => { setShowLinkInput(false); setLinkUrl(''); setLinkTitle(''); }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-tertiary)',
                  padding: 'var(--space-1)',
                  display: 'flex',
                }}
              >
                <CloseIcon />
              </button>
            </div>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
              style={{
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-default)',
                fontSize: 'var(--text-sm)',
                background: 'var(--color-bg-surface)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-sans)',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--color-accent-red)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--color-border-default)')}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Описание (необязательно)"
                style={{
                  flex: 1,
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-default)',
                  fontSize: 'var(--text-sm)',
                  background: 'var(--color-bg-surface)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-sans)',
                  outline: 'none',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--color-accent-red)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--color-border-default)')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendLink(); }}
              />
              <button
                disabled={sending || !linkUrl.trim()}
                onClick={handleSendLink}
                style={{
                  background: 'var(--color-accent-red)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  padding: 'var(--space-2) var(--space-4)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 'var(--font-medium)' as unknown as number,
                  letterSpacing: 'var(--tracking-wide)',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  opacity: (sending || !linkUrl.trim()) ? 0.38 : 1,
                }}
              >
                {sending ? '...' : 'Добавить'}
              </button>
            </div>
          </div>
        )}

        {/* Audio recording overlay */}
        {(isRecording || audioBlob) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border-default)',
          }}>
            {isRecording ? (
              <>
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-accent-red)',
                  animation: 'np-pulse 1.5s ease-in-out infinite',
                }} />
                <span style={{
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-accent-red)',
                  letterSpacing: 'var(--tracking-wide)',
                  flex: 1,
                }}>
                  {formatTime(recordingTime)}
                </span>
                <button
                  onClick={stopRecording}
                  style={{
                    background: 'var(--color-accent-red-dim)',
                    border: '1px solid var(--color-accent-red)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-accent-red)',
                    padding: 'var(--space-2) var(--space-3)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 'var(--font-medium)' as unknown as number,
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase',
                  }}
                >
                  <StopIcon /> Стоп
                </button>
              </>
            ) : audioBlob ? (
              <>
                <span style={{
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-secondary)',
                  flex: 1,
                  letterSpacing: 'var(--tracking-wide)',
                }}>
                  Запись {formatTime(recordingTime)}
                </span>
                <button
                  onClick={cancelAudio}
                  style={{
                    background: 'none',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-tertiary)',
                    padding: 'var(--space-2) var(--space-3)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase',
                  }}
                >
                  Отмена
                </button>
                <button
                  disabled={sending}
                  onClick={sendAudio}
                  style={{
                    background: 'var(--color-accent-red)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-primary)',
                    padding: 'var(--space-2) var(--space-4)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 'var(--font-medium)' as unknown as number,
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase',
                    opacity: sending ? 0.38 : 1,
                  }}
                >
                  {sending ? '...' : 'Отправить'}
                </button>
              </>
            ) : null}
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
            {/* File attach (paperclip) */}
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

            {/* Link */}
            <IconButton
              title="Добавить ссылку"
              active={showLinkInput}
              onClick={() => setShowLinkInput(!showLinkInput)}
              disabled={sending}
            >
              <LinkIcon />
            </IconButton>

            {/* Audio */}
            <IconButton
              title="Записать аудио"
              active={isRecording}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={sending || !!audioBlob}
              accent={isRecording}
            >
              <MicIcon />
            </IconButton>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={textContent}
            onChange={handleTextareaChange}
            placeholder="Сообщение..."
            rows={1}
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border-default)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              background: 'var(--color-bg-elevated)',
              color: 'var(--color-text-primary)',
              resize: 'none',
              overflow: 'hidden',
              lineHeight: 'var(--leading-normal)',
              outline: 'none',
              minHeight: 36,
              maxHeight: 160,
              transition: 'border-color var(--duration-fast) var(--ease-default)',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--color-accent-red)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--color-border-default)')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
          />

          {/* Send button */}
          <button
            disabled={sending || !hasText}
            onClick={handleSendText}
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: hasText ? 'var(--color-accent-red)' : 'var(--color-bg-elevated)',
              color: hasText ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
              cursor: hasText ? 'pointer' : 'default',
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
            ? 'var(--color-accent-red-dim)'
            : 'var(--color-bg-overlay)'
          : 'transparent',
        color: accent
          ? 'var(--color-accent-red)'
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

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h10v12H3z" />
      <path d="M6 2v12" />
      <path d="M6 5h4M6 8h4M6 11h4" />
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
      <path d="M2 2h12v9H5l-3 3V2z" />
      <path d="M5 6h6M5 9h3" />
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

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}

/* ─── Chat message bubble (messenger-style) ─── */

function MessageBubble({
  entry,
  currentUserId,
  showAuthor,
}: {
  entry: ThreadEntry;
  currentUserId: string;
  showAuthor: boolean;
}) {
  const isOwn = entry.authorId === currentUserId;
  const isAdmin = entry.author.role === 'admin';
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
        flexDirection: isOwn ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 'var(--space-2)',
        marginTop: showAuthor ? 'var(--space-4)' : 'var(--space-1)',
        maxWidth: '85%',
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
      }}
    >
      {/* Avatar */}
      {showAuthor ? (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-full)',
            background: isAdmin ? 'var(--color-accent-red-dim)' : 'var(--color-bg-overlay)',
            border: `1px solid ${isAdmin ? 'var(--color-accent-red)' : 'var(--color-border-default)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-bold)',
            color: isAdmin ? 'var(--color-accent-red)' : 'var(--color-text-secondary)',
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
        {/* Author name */}
        {showAuthor && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: isAdmin ? 'var(--color-accent-red)' : 'var(--color-text-tertiary)',
              marginBottom: 'var(--space-1)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
              textAlign: isOwn ? 'right' : 'left',
              paddingLeft: isOwn ? 0 : 'var(--space-2)',
              paddingRight: isOwn ? 'var(--space-2)' : 0,
            }}
          >
            {entry.author.name}
            {isAdmin && (
              <span style={{ color: 'var(--color-text-disabled)', marginLeft: 'var(--space-2)' }}>
                Преп.
              </span>
            )}
          </div>
        )}

        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: isOwn
              ? 'var(--radius-xl) var(--radius-xl) var(--radius-xs) var(--radius-xl)'
              : 'var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-xs)',
            background: isOwn
              ? 'var(--color-bg-overlay)'
              : isAdmin
                ? 'var(--color-accent-red-dim)'
                : 'var(--color-bg-elevated)',
            border: `1px solid ${
              isAdmin && !isOwn
                ? 'var(--color-accent-red)'
                : 'var(--color-border-default)'
            }`,
          }}
        >
          {/* Content */}
          <div style={{
            fontSize: 'var(--text-sm)',
            lineHeight: 'var(--leading-normal)',
            color: 'var(--color-text-primary)',
            wordBreak: 'break-word',
          }}>
            {entry.type === 'text' || entry.type === 'comment' || entry.type === 'note' ? (
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

          {/* Timestamp */}
          <div style={{
            fontSize: '10px',
            color: 'var(--color-text-disabled)',
            marginTop: 'var(--space-1)',
            textAlign: isOwn ? 'left' : 'right',
            fontFamily: 'var(--font-mono)',
            letterSpacing: 'var(--tracking-wide)',
          }}>
            {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Assignment link */}
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

function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}
