'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import {
  getThread,
  addThreadEntry,
  uploadThreadFile,
  updateStudentAssignment,
  getStudentAssignments,
  type ThreadEntry,
  type ThreadEntryType,
  type StudentAssignment,
} from '@/lib/api';

function PaperclipIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 9.25l-7.72 7.72a4.25 4.25 0 01-6.01-6.01L11.5 3.24a2.83 2.83 0 014 4L7.78 14.96a1.42 1.42 0 01-2-2l7.22-7.22" /></svg>;
}
function NoteIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h12v14H4z" /><path d="M7 7h6M7 10h6M7 13h3" /><path d="M4 3h12" strokeDasharray="2 2" /></svg>;
}
function SendIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10l14-7-7 14v-7H3z" fill="currentColor" stroke="none" /></svg>;
}
function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>;
}
function LinkIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 11.5a4 4 0 005.66 0l2.5-2.5a4 4 0 00-5.66-5.66l-1.25 1.25" /><path d="M11.5 8.5a4 4 0 00-5.66 0l-2.5 2.5a4 4 0 005.66 5.66l1.25-1.25" /></svg>;
}

export default function AdminStudentThreadPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const params = useParams();
  const studentId = params.id as string;

  const [studentName, setStudentName] = useState('');
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'comment' | 'note'>('comment');
  const [content, setContent] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchThread = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingData(true);
    try {
      const [data, saData] = await Promise.all([
        getThread(accessToken, studentId),
        getStudentAssignments(accessToken, { studentId }),
      ]);
      setStudentName(data.student.name);
      setEntries(data.entries);
      setStudentAssignments(saData.studentAssignments);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки треда');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, studentId]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') fetchThread();
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
      const { entry } = await addThreadEntry(accessToken, studentId, { type: inputMode as ThreadEntryType, content: content.trim() });
      setEntries((prev) => [...prev, entry]);
      setContent('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleSendLink = async () => {
    if (!accessToken || !linkUrl.trim()) return;
    setSending(true);
    try {
      const { entry } = await addThreadEntry(accessToken, studentId, {
        type: 'link',
        content: linkUrl.trim(),
        ...(linkTitle.trim() ? { metadata: { title: linkTitle.trim() } } : {}),
      });
      setEntries((prev) => [...prev, entry]);
      setLinkUrl(''); setLinkTitle(''); setShowLinkInput(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;
    if (file.size > 50 * 1024 * 1024) { setError('Файл превышает максимальный размер 50MB'); return; }
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

  const handleReview = async (saId: string, newStatus: 'reviewed' | 'needs_revision') => {
    if (!accessToken) return;
    setReviewingId(saId);
    try {
      await updateStudentAssignment(accessToken, saId, { status: newStatus });
      const saData = await getStudentAssignments(accessToken, { studentId });
      setStudentAssignments(saData.studentAssignments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления статуса');
    } finally {
      setReviewingId(null);
    }
  };

  const hasContent = content.trim().length > 0;
  const latestSubmissionEntryId: Record<string, string> = {};
  for (const e of entries) {
    if (e.metadata?.submissionType === 'assignment' && e.assignmentId) {
      latestSubmissionEntryId[e.assignmentId] = e.id;
    }
  }

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-var(--header-height))] max-w-[800px] mx-auto">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => router.push('/admin/students')}
            className="flex items-center gap-1 mb-2 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors font-sans"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 2L4 7l5 5" /></svg>
            К списку учеников
          </button>
          <h1 className="text-lg font-bold font-sans tracking-tight text-[var(--color-text-primary)] m-0">
            {studentName || 'Загрузка...'}
          </h1>
          <p className="text-[var(--color-text-tertiary)] mt-1 text-sm font-mono tracking-wide uppercase">
            Тред ученика
          </p>
        </div>

        {/* Error toast */}
        {error && (
          <div className="mx-4 mt-3 px-4 py-3 bg-[var(--color-error-dim)] border border-[var(--color-error)] rounded-[var(--radius-sm)] text-[var(--color-error)] text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="flex text-[var(--color-error)] cursor-pointer p-1 bg-transparent border-none">
              <CloseIcon />
            </button>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {loadingData ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <p className="text-[var(--color-text-tertiary)] text-sm font-mono tracking-wide uppercase">Тред пуст</p>
            </div>
          ) : (
            entries.map((entry, i) => {
              const showGroupHeader = entry.assignmentId && entry.assignmentId !== entries[i - 1]?.assignmentId;
              const isSubmission = entry.metadata?.submissionType === 'assignment' && entry.assignmentId;
              const relatedSa = isSubmission ? studentAssignments.find((sa) => sa.assignmentId === entry.assignmentId) : null;
              const isLatestSubmission = isSubmission && entry.assignmentId && latestSubmissionEntryId[entry.assignmentId] === entry.id;

              return (
                <div key={entry.id}>
                  {showGroupHeader && (
                    <div className="flex items-center gap-2 px-3 py-2 mt-3 mb-2 bg-[rgba(77,166,255,0.06)] border border-[rgba(77,166,255,0.15)] rounded-[var(--radius-sm)]">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-info)" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="6" /><path d="M5 5.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1.5-1.5 1.5" /><circle cx="7" cy="10.5" r="0.5" fill="var(--color-info)" stroke="none" /></svg>
                      <span className="text-xs font-mono text-[var(--color-info)] tracking-wide">
                        {isSubmission ? 'Сданная работа' : 'Вопросы по заданию'}: {entry.assignment?.title}
                      </span>
                    </div>
                  )}
                  {isSubmission && relatedSa ? (
                    <SubmissionThreadCard
                      entry={entry}
                      sa={relatedSa}
                      studentName={studentName}
                      onAccept={() => handleReview(relatedSa.id, 'reviewed')}
                      onRequestRevision={() => handleReview(relatedSa.id, 'needs_revision')}
                      isReviewing={reviewingId === relatedSa.id}
                      showActions={!!isLatestSubmission}
                    />
                  ) : (
                    <AdminMessageBubble
                      entry={entry}
                      showAuthor={i === 0 || entries[i - 1]!.authorId !== entry.authorId}
                    />
                  )}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Compose bar */}
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3 bg-[var(--color-bg-surface)]">
          {/* Link input panel */}
          {showLinkInput && (
            <div className="flex flex-col gap-2 p-3 mb-3 bg-[var(--color-bg-elevated)] rounded-[var(--radius-md)] border border-[var(--color-border-default)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[var(--color-text-tertiary)] tracking-wide uppercase">Добавить ссылку</span>
                <button
                  onClick={() => { setShowLinkInput(false); setLinkUrl(''); setLinkTitle(''); }}
                  className="flex text-[var(--color-text-tertiary)] cursor-pointer p-1 bg-transparent border-none"
                >
                  <CloseIcon />
                </button>
              </div>
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
                className="px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] text-sm bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-sans outline-none focus:border-[var(--color-accent-red)]"
              />
              <div className="flex gap-2">
                <input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="Описание (необязательно)"
                  className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] text-sm bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-sans outline-none focus:border-[var(--color-accent-red)]"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendLink(); }}
                />
                <button
                  disabled={sending || !linkUrl.trim()}
                  onClick={handleSendLink}
                  className="px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--color-accent-red)] text-white text-xs font-sans uppercase tracking-wide cursor-pointer border-none disabled:opacity-40"
                >
                  {sending ? '...' : 'Добавить'}
                </button>
              </div>
            </div>
          )}

          {/* Note mode indicator */}
          {inputMode === 'note' && (
            <div className="flex items-center justify-between px-3 py-2 mb-2 bg-[var(--color-warning-dim)] border border-[var(--color-warning)] rounded-[var(--radius-sm)]">
              <span className="text-xs font-mono text-[var(--color-warning)] tracking-wide uppercase">
                Приватная заметка — ученик не увидит
              </span>
              <button
                onClick={() => setInputMode('comment')}
                className="flex text-[var(--color-warning)] cursor-pointer p-1 bg-transparent border-none"
              >
                <CloseIcon />
              </button>
            </div>
          )}

          {/* Main compose row */}
          <div className="flex items-end gap-2">
            <div className="flex gap-1">
              <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
              <IconButton title="Прикрепить файл" onClick={() => fileInputRef.current?.click()} disabled={sending}>
                <PaperclipIcon />
              </IconButton>
              <IconButton
                title="Добавить ссылку"
                active={showLinkInput}
                onClick={() => { setShowLinkInput(!showLinkInput); if (inputMode === 'note') setInputMode('comment'); }}
                disabled={sending}
              >
                <LinkIcon />
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

            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleTextareaChange}
              placeholder={inputMode === 'comment' ? 'Комментарий для ученика...' : 'Приватная заметка...'}
              rows={1}
              className={[
                'flex-1 px-3 py-2 rounded-[var(--radius-lg)] border text-sm font-sans resize-none overflow-hidden outline-none leading-normal transition-colors',
                inputMode === 'note'
                  ? 'border-[var(--color-warning)] bg-[var(--color-warning-dim)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-red)]',
              ].join(' ')}
              style={{ minHeight: 36, maxHeight: 160 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
            />

            <button
              disabled={sending || !hasContent}
              onClick={handleSend}
              className={[
                'w-9 h-9 rounded-full border-none flex items-center justify-center shrink-0 transition-colors cursor-pointer',
                hasContent
                  ? 'bg-[var(--color-accent-red)] text-white'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)] cursor-default',
              ].join(' ')}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function IconButton({
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
      className={[
        'w-9 h-9 rounded-full border-none flex items-center justify-center shrink-0 transition-colors',
        disabled ? 'opacity-40 cursor-default' : 'cursor-pointer',
        accent
          ? 'bg-[var(--color-warning-dim)] text-[var(--color-warning)]'
          : active
            ? 'bg-[var(--color-bg-overlay)] text-[var(--color-text-primary)]'
            : 'bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-text-primary)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Сдана',
  reviewed: 'Принята',
  needs_revision: 'На доработке',
};
const SUBMISSION_STATUS_COLORS: Record<string, string> = {
  submitted: 'var(--color-success)',
  reviewed: 'var(--color-text-disabled)',
  needs_revision: 'var(--color-error)',
};

function SubmissionThreadCard({
  entry, sa, studentName, onAccept, onRequestRevision, isReviewing, showActions,
}: {
  entry: ThreadEntry;
  sa: StudentAssignment;
  studentName: string;
  onAccept: () => void;
  onRequestRevision: () => void;
  isReviewing: boolean;
  showActions: boolean;
}) {
  const date = new Date(entry.createdAt);
  const statusColor = SUBMISSION_STATUS_COLORS[sa.status] || 'var(--color-text-disabled)';

  return (
    <div className="max-w-[85%] self-start mt-4 ml-[calc(32px+0.5rem)]">
      <div className="border border-[var(--color-success)] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--color-bg-surface)]">
        {/* Header */}
        <div className="px-4 py-3 bg-[rgba(0,200,83,0.06)] border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-mono font-semibold tracking-wide uppercase border"
              style={{ color: statusColor, background: `color-mix(in srgb, ${statusColor} 10%, transparent)`, borderColor: statusColor }}
            >
              {sa.status === 'submitted' && (
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: statusColor }} />
              )}
              {SUBMISSION_STATUS_LABELS[sa.status] || sa.status}
            </span>
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{entry.assignment?.title}</span>
          </div>
          <span className="text-xs text-[var(--color-text-disabled)] font-mono">
            {date.toLocaleString('ru-RU', { day: 'numeric', month: 'short' })} · {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Body */}
        <div className="p-4">
          <div className="text-xs text-[var(--color-text-tertiary)] font-mono tracking-wide mb-2">Студент: {studentName}</div>

          {sa.content && (
            <div className="p-3 bg-[var(--color-bg-overlay)] border-l-[3px] border-[var(--color-info)] rounded-[var(--radius-xs)] mb-3">
              <p className="whitespace-pre-wrap m-0 text-sm leading-relaxed text-[var(--color-text-secondary)] italic">{sa.content}</p>
            </div>
          )}

          {sa.fileName && (
            <div className="flex items-center gap-3 px-3 py-2 bg-[var(--color-bg-overlay)] rounded-[var(--radius-xs)] border border-[var(--color-border-subtle)] mb-3">
              <div className="w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] flex items-center justify-center shrink-0 text-[var(--color-text-tertiary)]">
                <PaperclipIcon />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium overflow-hidden text-ellipsis whitespace-nowrap text-[var(--color-text-primary)]">{sa.fileName}</div>
                {sa.fileSize && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {sa.fileSize < 1024 * 1024
                      ? `${Math.round(sa.fileSize / 1024)} КБ`
                      : `${(sa.fileSize / (1024 * 1024)).toFixed(1)} МБ`}
                  </span>
                )}
              </div>
              {sa.fileSignedUrl && (
                <a href={sa.fileSignedUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[var(--color-info)] no-underline font-mono tracking-wide uppercase">
                  Открыть ↗
                </a>
              )}
            </div>
          )}

          {showActions && sa.status === 'submitted' && (
            <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
              <button
                onClick={onAccept}
                disabled={isReviewing}
                className="flex-1 py-2 px-3 rounded-[var(--radius-sm)] border border-[var(--color-success)] bg-[rgba(0,200,83,0.08)] text-[var(--color-success)] text-sm font-sans cursor-pointer disabled:opacity-50 transition-colors"
              >
                {isReviewing ? '…' : 'Принять'}
              </button>
              <button
                onClick={onRequestRevision}
                disabled={isReviewing}
                className="flex-1 py-2 px-3 rounded-[var(--radius-sm)] border border-[var(--color-error)] bg-[rgba(255,77,77,0.08)] text-[var(--color-error)] text-sm font-sans cursor-pointer disabled:opacity-50 transition-colors"
              >
                {isReviewing ? '…' : 'На доработке'}
              </button>
            </div>
          )}

          {(sa.status === 'reviewed' || sa.status === 'needs_revision') && (
            <div className="mt-2 text-xs font-mono tracking-wide uppercase" style={{ color: statusColor }}>
              {SUBMISSION_STATUS_LABELS[sa.status]}
              {sa.reviewedAt && (
                <span className="ml-2 text-[var(--color-text-disabled)]">
                  {new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PaperclipIconSm() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 9.25l-7.72 7.72a4.25 4.25 0 01-6.01-6.01L11.5 3.24a2.83 2.83 0 014 4L7.78 14.96a1.42 1.42 0 01-2-2l7.22-7.22" /></svg>;
}

function AdminMessageBubble({ entry, showAuthor }: { entry: ThreadEntry; showAuthor: boolean }) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);
  const initials = entry.author.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const avatarColor = isNote
    ? 'bg-[var(--color-warning-dim)] border-[var(--color-warning)] text-[var(--color-warning)]'
    : isAdmin
      ? 'bg-[var(--color-accent-red-dim)] border-[var(--color-accent-red)] text-[var(--color-accent-red)]'
      : 'bg-[var(--color-bg-overlay)] border-[var(--color-border-default)] text-[var(--color-text-secondary)]';

  const bubbleBg = isNote
    ? 'bg-[var(--color-warning-dim)] border-[var(--color-warning)] border-dashed'
    : isAdmin
      ? 'bg-[var(--color-bg-overlay)] border-[var(--color-border-default)]'
      : 'bg-[var(--color-bg-elevated)] border-[var(--color-border-default)]';

  const bubbleRadius = isAdmin
    ? 'rounded-[var(--radius-xl)_var(--radius-xl)_var(--radius-xs)_var(--radius-xl)]'
    : 'rounded-[var(--radius-xl)_var(--radius-xl)_var(--radius-xl)_var(--radius-xs)]';

  const nameColor = isNote
    ? 'text-[var(--color-warning)]'
    : isAdmin
      ? 'text-[var(--color-accent-red)]'
      : 'text-[var(--color-text-tertiary)]';

  return (
    <div className={[
      'flex items-end gap-2 max-w-[85%]',
      showAuthor ? 'mt-4' : 'mt-1',
      isAdmin ? 'flex-row-reverse self-end' : 'flex-row self-start',
    ].join(' ')}>
      {showAuthor ? (
        <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-mono font-bold shrink-0 tracking-wide ${avatarColor}`}>
          {initials}
        </div>
      ) : (
        <div className="w-8 shrink-0" />
      )}

      <div className="min-w-0">
        {showAuthor && (
          <div className={[
            'text-xs font-mono tracking-wide uppercase mb-1',
            nameColor,
            isAdmin ? 'text-right pr-2' : 'text-left pl-2',
          ].join(' ')}>
            {entry.author.name}
            {isNote && <span className="ml-2 text-[var(--color-warning)]">заметка</span>}
          </div>
        )}

        <div className={`px-4 py-3 border ${bubbleBg} ${bubbleRadius}`}>
          <div className="text-sm leading-normal text-[var(--color-text-primary)] break-words">
            {['text', 'comment', 'note'].includes(entry.type) ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'link' ? (
              <AdminLinkCard entry={entry} />
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--color-bg-overlay)] border border-[var(--color-border-default)] flex items-center justify-center shrink-0 text-[var(--color-text-tertiary)]">
                  <PaperclipIconSm />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium overflow-hidden text-ellipsis whitespace-nowrap text-[var(--color-text-primary)]">
                    {entry.metadata?.fileName || entry.content}
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.metadata?.size && (
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {(entry.metadata.size / 1024 / 1024).toFixed(1)} МБ
                      </span>
                    )}
                    {entry.metadata?.url && (
                      <a href={entry.metadata.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-[var(--color-info)] no-underline font-mono tracking-wide uppercase">
                        Скачать
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : entry.type === 'audio' ? (
              <div>
                {entry.metadata?.url ? (
                  <audio controls src={entry.metadata.url} className="max-w-full h-9 rounded-[var(--radius-sm)]" />
                ) : (
                  <span className="text-[var(--color-text-tertiary)]">Аудиозапись</span>
                )}
              </div>
            ) : null}
          </div>

          <div className={`flex items-center gap-1 mt-1 ${isAdmin ? 'justify-start' : 'justify-end'}`}>
            <span className="text-[10px] text-[var(--color-text-disabled)] font-mono tracking-wide">
              {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isAdmin && entry.readAt && (
              <span className="text-[10px] text-[var(--color-text-disabled)] font-mono tracking-wide flex items-center gap-[2px]">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 8l4 4 9-9" /><path d="M5 8l4 4 5-5" /></svg>
                Прочитано
              </span>
            )}
          </div>
        </div>

        {entry.assignment && (
          <div className="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-[rgba(77,166,255,0.06)] text-[var(--color-info)] rounded-full text-xs font-mono tracking-wide">
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="6" /><path d="M5 5.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1.5-1.5 1.5" /><circle cx="7" cy="10.5" r="0.5" fill="currentColor" stroke="none" /></svg>
            {entry.assignment.title.length > 30 ? entry.assignment.title.slice(0, 30) + '...' : entry.assignment.title}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminLinkCard({ entry }: { entry: ThreadEntry }) {
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
      className="flex items-start gap-3 no-underline text-inherit px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-info)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] transition-colors"
    >
      <div className="w-7 h-7 rounded-[var(--radius-sm)] bg-[rgba(59,130,246,0.12)] flex items-center justify-center shrink-0 text-[var(--color-info)] mt-0.5">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 11.5a4 4 0 005.66 0l2.5-2.5a4 4 0 00-5.66-5.66l-1.25 1.25" />
          <path d="M11.5 8.5a4 4 0 00-5.66 0l-2.5 2.5a4 4 0 005.66 5.66l1.25-1.25" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        {title && <div className="text-sm font-medium text-[var(--color-text-primary)] mb-1 overflow-hidden text-ellipsis whitespace-nowrap">{title}</div>}
        <div className="text-xs text-[var(--color-info)] overflow-hidden text-ellipsis whitespace-nowrap font-mono">{url}</div>
      </div>
    </a>
  );
}

