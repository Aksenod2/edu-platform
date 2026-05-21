'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';
import {
  getThread,
  addThreadEntry,
  uploadThreadFile,
  type ThreadEntry,
} from '@/lib/api';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',        href: '/dashboard',               icon: <GridIcon /> },
      { label: 'Уроки',        href: '/dashboard/lessons',       icon: <BookIcon /> },
      { label: 'Задания',      href: '/dashboard/assignments',   icon: <ClipboardIcon /> },
      { label: 'Тред',         href: '/dashboard/thread',        icon: <ChatIcon /> },
      { label: 'Расписание',   href: '/dashboard/schedule',      icon: <CalendarIcon /> },
      { label: 'Уведомления',  href: '/dashboard/notifications', icon: <BellNavIcon /> },
      { label: 'Материалы',    href: '/dashboard/materials',     icon: <FolderIcon /> },
      { label: 'Профиль',      href: '/dashboard/profile',       icon: <UserIcon /> },
      { label: 'Настройки',    href: '/dashboard/settings',      icon: <GearIcon /> },
    ],
  },
];

export default function StudentThreadPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const [activeContext, setActiveContext] = useState<{ id: string; title: string } | null>(null);
  const [textContent, setTextContent] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('assignmentId');
    const title = params.get('title');
    if (id && title) setActiveContext({ id, title: decodeURIComponent(title) });
  }, []);

  const clearActiveContext = () => {
    setActiveContext(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('assignmentId');
    url.searchParams.delete('title');
    window.history.replaceState({}, '', url.pathname);
  };

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
    if (accessToken && user?.role === 'student') fetchThread();
  }, [accessToken, user, fetchThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

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
        ...(activeContext && { assignmentId: activeContext.id }),
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
        ...(activeContext && { assignmentId: activeContext.id }),
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
    if (file.size > 50 * 1024 * 1024) { setError('Файл превышает максимальный размер 50MB'); return; }
    setSending(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, user.id, file, 'file', activeContext?.id);
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
      const { entry } = await uploadThreadFile(accessToken, user.id, file, 'audio', activeContext?.id);
      setEntries((prev) => [...prev, entry]);
      setAudioBlob(null);
      setRecordingTime(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки аудио');
    } finally {
      setSending(false);
    }
  };

  const cancelAudio = () => { setAudioBlob(null); setRecordingTime(0); };
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
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
      <div
        className="flex flex-col"
        style={{ height: 'calc(100vh - var(--header-height))', maxWidth: 800, margin: '0 auto' }}
      >
        {/* Page header */}
        <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-1 mb-2 font-sans text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors duration-150 bg-transparent border-0 cursor-pointer p-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2L4 7l5 5" />
            </svg>
            Назад
          </button>
          <h1 className="font-sans text-lg font-semibold text-[var(--color-text-primary)] tracking-tight m-0">
            Мой тред
          </h1>
          <p className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide mt-1 m-0">
            Записи · файлы · обратная связь
          </p>
        </div>

        {/* Error toast */}
        {error && (
          <div className="mx-4 mt-3 px-4 py-3 bg-[var(--color-error-dim)] border border-[var(--color-error)] flex justify-between items-center gap-3">
            <span className="font-sans text-sm text-[var(--color-error)]">{error}</span>
            <button onClick={() => setError('')} className="flex text-[var(--color-error)] bg-transparent border-0 cursor-pointer p-1 hover:opacity-70">
              <CloseIcon />
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
          {loadingData ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full border-2 border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-tertiary)]">
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 2h12v9H5l-3 3V2z" /><path d="M5 6h6M5 9h3" />
                </svg>
              </div>
              <p className="font-mono text-sm text-[var(--color-text-tertiary)] uppercase tracking-wide">
                Тред пуст
              </p>
              <p className="font-sans text-sm text-[var(--color-text-disabled)]">
                Напишите первое сообщение
              </p>
            </div>
          ) : (
            entries.map((entry, i) => {
              const showGroupHeader =
                entry.assignmentId && entry.assignmentId !== entries[i - 1]?.assignmentId;
              return (
                <div key={entry.id}>
                  {showGroupHeader && (
                    <div className="flex items-center gap-2 px-3 py-2 mt-3 mb-2 bg-[rgba(77,166,255,0.06)] border border-[rgba(77,166,255,0.15)]">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-info)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="7" cy="7" r="6" />
                        <path d="M5 5.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1.5-1.5 1.5" />
                        <circle cx="7" cy="10.5" r="0.5" fill="var(--color-info)" stroke="none" />
                      </svg>
                      <span className="font-mono text-xs text-[var(--color-info)] tracking-wide">
                        Вопросы по заданию: {entry.assignment?.title}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    entry={entry}
                    currentUserId={user.id}
                    showAuthor={i === 0 || entries[i - 1].authorId !== entry.authorId}
                  />
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Compose bar */}
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3 bg-[var(--color-bg-surface)]">
          {/* Context banner */}
          {activeContext && (
            <div className="flex items-center justify-between px-3 py-2 mb-2 bg-[rgba(77,166,255,0.06)] border border-[rgba(77,166,255,0.15)]">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-info)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7" cy="7" r="6" />
                  <path d="M5 5.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1.5-1.5 1.5" />
                  <circle cx="7" cy="10.5" r="0.5" fill="var(--color-info)" stroke="none" />
                </svg>
                <span className="font-mono text-xs text-[var(--color-info)] tracking-wide">
                  Вопрос по заданию: {activeContext.title}
                </span>
              </div>
              <button onClick={clearActiveContext} className="flex text-[var(--color-info)] bg-transparent border-0 cursor-pointer p-1 hover:opacity-70">
                <CloseIcon />
              </button>
            </div>
          )}

          {/* Link panel */}
          {showLinkInput && (
            <div className="flex flex-col gap-2 p-3 mb-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)]">
              <div className="flex justify-between items-center">
                <span className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide">Добавить ссылку</span>
                <button onClick={() => { setShowLinkInput(false); setLinkUrl(''); setLinkTitle(''); }} className="flex text-[var(--color-text-tertiary)] bg-transparent border-0 cursor-pointer p-1 hover:opacity-70">
                  <CloseIcon />
                </button>
              </div>
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
                className="w-full px-3 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] font-sans text-sm placeholder:text-[var(--color-text-disabled)] focus:outline-none focus:border-[var(--color-accent-red)]"
              />
              <div className="flex gap-2">
                <input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="Описание (необязательно)"
                  className="flex-1 px-3 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] font-sans text-sm placeholder:text-[var(--color-text-disabled)] focus:outline-none focus:border-[var(--color-accent-red)]"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendLink(); }}
                />
                <button
                  disabled={sending || !linkUrl.trim()}
                  onClick={handleSendLink}
                  className="px-4 py-2 bg-[var(--color-accent-red)] text-white font-mono text-xs uppercase tracking-wide cursor-pointer disabled:opacity-40 disabled:cursor-default border-0"
                >
                  {sending ? '...' : 'Добавить'}
                </button>
              </div>
            </div>
          )}

          {/* Audio overlay */}
          {(isRecording || audioBlob) && (
            <div className="flex items-center gap-3 p-3 mb-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)]">
              {isRecording ? (
                <>
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent-red)] animate-[np-pulse_1.5s_ease-in-out_infinite]" />
                  <span className="font-mono text-sm text-[var(--color-accent-red)] tracking-wide flex-1">
                    {formatTime(recordingTime)}
                  </span>
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-2 px-3 py-2 bg-[var(--color-accent-red-dim)] border border-[var(--color-accent-red)] text-[var(--color-accent-red)] font-mono text-xs uppercase tracking-wide cursor-pointer"
                  >
                    <StopIcon /> Стоп
                  </button>
                </>
              ) : audioBlob ? (
                <>
                  <span className="font-mono text-sm text-[var(--color-text-secondary)] flex-1 tracking-wide">
                    Запись {formatTime(recordingTime)}
                  </span>
                  <button
                    onClick={cancelAudio}
                    className="px-3 py-2 border border-[var(--color-border-default)] text-[var(--color-text-tertiary)] font-mono text-xs uppercase tracking-wide cursor-pointer bg-transparent"
                  >
                    Отмена
                  </button>
                  <button
                    disabled={sending}
                    onClick={sendAudio}
                    className="px-4 py-2 bg-[var(--color-accent-red)] text-white font-mono text-xs uppercase tracking-wide cursor-pointer disabled:opacity-40 border-0"
                  >
                    {sending ? '...' : 'Отправить'}
                  </button>
                </>
              ) : null}
            </div>
          )}

          {/* Main compose row */}
          <div className="flex items-end gap-2">
            <div className="flex gap-1">
              <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
              <ComposeIconBtn title="Прикрепить файл" onClick={() => fileInputRef.current?.click()} disabled={sending}>
                <PaperclipIcon />
              </ComposeIconBtn>
              <ComposeIconBtn title="Добавить ссылку" active={showLinkInput} onClick={() => setShowLinkInput(!showLinkInput)} disabled={sending}>
                <LinkIcon />
              </ComposeIconBtn>
              <ComposeIconBtn title="Записать аудио" active={isRecording} accent={isRecording} onClick={isRecording ? stopRecording : startRecording} disabled={sending || !!audioBlob}>
                <MicIcon />
              </ComposeIconBtn>
            </div>

            <textarea
              ref={textareaRef}
              value={textContent}
              onChange={handleTextareaChange}
              placeholder="Сообщение..."
              rows={1}
              className="flex-1 px-3 py-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] font-sans text-sm resize-none overflow-hidden leading-normal focus:outline-none focus:border-[var(--color-accent-red)] transition-colors duration-150 placeholder:text-[var(--color-text-disabled)]"
              style={{ minHeight: 36, maxHeight: 160 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
            />

            <button
              disabled={sending || !hasText}
              onClick={handleSendText}
              className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center border-0 transition-colors duration-150 ${hasText ? 'bg-[var(--color-accent-red)] text-white cursor-pointer' : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)] cursor-default'}`}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ─── Compose icon button ─── */
function ComposeIconBtn({
  children, title, onClick, disabled, active, accent,
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
      className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center border-0 transition-colors duration-150 ${
        disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'
      } ${
        active
          ? accent
            ? 'bg-[var(--color-accent-red-dim)] text-[var(--color-accent-red)]'
            : 'bg-[var(--color-bg-overlay)] text-[var(--color-text-primary)]'
          : 'bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

/* ─── Message bubble ─── */
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
  const initials = entry.author.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div
      className={`flex items-end gap-2 ${showAuthor ? 'mt-4' : 'mt-1'}`}
      style={{
        flexDirection: isOwn ? 'row-reverse' : 'row',
        maxWidth: '85%',
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
      }}
    >
      {showAuthor ? (
        <div
          className={`w-8 h-8 rounded-full flex flex-shrink-0 items-center justify-center font-mono text-xs font-bold tracking-wide ${
            isAdmin
              ? 'bg-[var(--color-accent-red-dim)] border border-[var(--color-accent-red)] text-[var(--color-accent-red)]'
              : 'bg-[var(--color-bg-overlay)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)]'
          }`}
        >
          {initials}
        </div>
      ) : (
        <div className="w-8 flex-shrink-0" />
      )}

      <div className="min-w-0">
        {showAuthor && (
          <div
            className={`font-mono text-xs uppercase tracking-wide mb-1 ${isAdmin ? 'text-[var(--color-accent-red)]' : 'text-[var(--color-text-tertiary)]'}`}
            style={{ textAlign: isOwn ? 'right' : 'left', paddingLeft: isOwn ? 0 : 8, paddingRight: isOwn ? 8 : 0 }}
          >
            {entry.author.name}
            {isAdmin && <span className="text-[var(--color-text-disabled)] ml-2">Преп.</span>}
          </div>
        )}

        <div
          className={`px-4 py-3 border ${
            isAdmin && !isOwn
              ? 'bg-[var(--color-accent-red-dim)] border-[var(--color-accent-red)]'
              : isOwn
                ? 'bg-[var(--color-bg-overlay)] border-[var(--color-border-default)]'
                : 'bg-[var(--color-bg-elevated)] border-[var(--color-border-default)]'
          }`}
        >
          <div className="font-sans text-sm text-[var(--color-text-primary)] break-words leading-normal">
            {entry.type === 'text' || entry.type === 'comment' || entry.type === 'note' ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'link' ? (
              <LinkCard entry={entry} />
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 flex-shrink-0 border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] flex items-center justify-center text-[var(--color-text-tertiary)]">
                  <PaperclipIcon />
                </div>
                <div className="min-w-0">
                  <div className="font-sans text-sm font-medium truncate">
                    {entry.metadata?.fileName || entry.content}
                  </div>
                  <div className="flex gap-3 items-center">
                    {entry.metadata?.size && (
                      <span className="font-sans text-xs text-[var(--color-text-tertiary)]">
                        {(entry.metadata.size / 1024 / 1024).toFixed(1)} МБ
                      </span>
                    )}
                    {entry.metadata?.url && (
                      <a href={entry.metadata.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-[var(--color-info)] uppercase tracking-wide no-underline hover:underline">
                        Скачать
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : entry.type === 'audio' ? (
              <div>
                {entry.metadata?.url ? (
                  <audio controls src={entry.metadata.url} className="max-w-full h-9" />
                ) : (
                  <span className="text-[var(--color-text-tertiary)]">Аудиозапись</span>
                )}
              </div>
            ) : null}
          </div>

          <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-start' : 'justify-end'}`}>
            <span className="font-mono text-[10px] text-[var(--color-text-disabled)] tracking-wide">
              {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isOwn && entry.readAt && (
              <span className="font-mono text-[10px] text-[var(--color-text-disabled)] flex items-center gap-0.5 tracking-wide">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 8l4 4 9-9" /><path d="M5 8l4 4 5-5" />
                </svg>
                Прочитано
              </span>
            )}
          </div>
        </div>

        {entry.assignment && (
          <div className="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-[rgba(77,166,255,0.06)] text-[var(--color-info)] font-mono text-xs tracking-wide rounded-full">
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="6" />
              <path d="M5 5.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1.5-1.5 1.5" />
              <circle cx="7" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
            </svg>
            {entry.assignment.title.length > 30 ? entry.assignment.title.slice(0, 30) + '...' : entry.assignment.title}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Link card ─── */
function LinkCard({ entry }: { entry: ThreadEntry }) {
  let url: string;
  let title: string | undefined;

  if (entry.metadata?.title) {
    url = entry.content;
    title = entry.metadata.title as string;
  } else if (entry.content.includes('\n')) {
    const parts = entry.content.split('\n');
    title = parts[0];
    url = parts.slice(1).join('\n');
  } else {
    url = entry.content;
    title = undefined;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 no-underline text-current p-3 border border-[var(--color-info)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] transition-colors duration-150"
    >
      <div className="w-7 h-7 flex-shrink-0 bg-[rgba(59,130,246,0.12)] flex items-center justify-center text-[var(--color-info)] mt-0.5">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 11.5a4 4 0 005.66 0l2.5-2.5a4 4 0 00-5.66-5.66l-1.25 1.25" />
          <path d="M11.5 8.5a4 4 0 00-5.66 0l-2.5 2.5a4 4 0 005.66 5.66l1.25-1.25" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        {title && <div className="font-sans text-sm font-medium text-[var(--color-text-primary)] mb-1 truncate">{title}</div>}
        <div className="font-mono text-xs text-[var(--color-info)] truncate">{url}</div>
      </div>
    </a>
  );
}

/* ─── SVG icons ─── */
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
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <path d="M3 10l14-7-7 14v-7H3z" />
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
      <rect x="3" y="2" width="10" height="13" rx="1" /><path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
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
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" /><path d="M8 2.5V1" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4h5l2 2h7v8H1z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}
