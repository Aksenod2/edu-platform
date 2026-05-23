'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  Loader2,
  Paperclip,
  Link2,
  StickyNote,
  Send,
  X,
  Download,
  Check,
  CheckCheck,
} from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cn } from '@platform/ui/lib/utils';
import { usePolling, isNearBottom, mergeById } from '@/lib/chat-realtime';

const POLL_INTERVAL_MS = 5000;

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatBytes(size: number) {
  return size < 1024 * 1024
    ? `${Math.round(size / 1024)} КБ`
    : `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

const SUBMISSION_STATUS: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  submitted: { label: 'Сдана', variant: 'default' },
  reviewed: { label: 'Принята', variant: 'secondary' },
  needs_revision: { label: 'На доработке', variant: 'destructive' },
};

/**
 * Полный тред одного ученика с inline-композером для ответа.
 * Переиспользуется на странице треда ученика и в общем инбоксе «Сообщения».
 */
export function ThreadConversation({
  studentId,
  onReplied,
}: {
  studentId: string;
  onReplied?: () => void;
}) {
  const { accessToken } = useAuth();

  const [studentName, setStudentName] = useState('');
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [inputMode, setInputMode] = useState<'comment' | 'note'>('comment');
  const [content, setContent] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // Прижата ли лента к низу — чтобы поллинг не дёргал скролл, когда читают историю.
  const stickToBottom = useRef(true);
  const entriesLenRef = useRef(0);
  useEffect(() => {
    entriesLenRef.current = entries.length;
  }, [entries]);

  const load = useCallback(
    async (silent = false) => {
      if (!accessToken || !studentId) return;
      if (!silent) setLoading(true);
      try {
        const [data, saData] = await Promise.all([
          getThread(accessToken, studentId),
          getStudentAssignments(accessToken, { studentId }),
        ]);
        const prevLen = entriesLenRef.current;
        setStudentName(data.student.name);
        setEntries((prev) => (silent ? mergeById(data.entries, prev) : data.entries));
        setStudentAssignments(saData.studentAssignments);
        setError('');
        // Пришли новые сообщения — обновим список тредов/бейджи в инбоксе.
        if (silent && data.entries.length > prevLen) onReplied?.();
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : 'Ошибка загрузки треда');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accessToken, studentId, onReplied],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  usePolling(() => load(true), POLL_INTERVAL_MS);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = isNearBottom(el);
  };

  // Прокрутка к низу: мгновенно при первой загрузке треда; при новых сообщениях —
  // только если пользователь у низа (или сам только что ответил).
  useEffect(() => {
    if (loading || entries.length === 0) return;
    if (!didInitialScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      didInitialScroll.current = true;
      return;
    }
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, loading]);

  // Сбрасываем флаги при переключении ученика, чтобы новый тред скроллился мгновенно.
  useEffect(() => {
    didInitialScroll.current = false;
    stickToBottom.current = true;
  }, [studentId]);

  const handleSend = async () => {
    if (!accessToken || !content.trim()) return;
    setSending(true);
    try {
      const { entry } = await addThreadEntry(accessToken, studentId, {
        type: inputMode as ThreadEntryType,
        content: content.trim(),
      });
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
      setContent('');
      onReplied?.();
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
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
      setLinkUrl('');
      setLinkTitle('');
      setShowLinkInput(false);
      onReplied?.();
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
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
      onReplied?.();
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

  const latestSubmissionEntryId: Record<string, string> = {};
  for (const e of entries) {
    if (e.metadata?.submissionType === 'assignment' && e.assignmentId) {
      latestSubmissionEntryId[e.assignmentId] = e.id;
    }
  }

  const hasContent = content.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <Alert variant="destructive" className="m-3">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span className="break-all">{error}</span>
            <button onClick={() => setError('')} className="shrink-0">
              <X className="size-4" />
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
      >
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Тред пуст</p>
          </div>
        ) : (
          // mt-auto прижимает ленту к низу: при малом числе сообщений они липнут
          // к полю ввода, а при переполнении старые сообщения уходят вверх.
          <div className="mt-auto flex flex-col gap-2">
            {entries.map((entry, i) => {
              const showGroupHeader =
                entry.assignmentId && entry.assignmentId !== entries[i - 1]?.assignmentId;
              const isSubmission =
                entry.metadata?.submissionType === 'assignment' && entry.assignmentId;
              const relatedSa = isSubmission
                ? studentAssignments.find((sa) => sa.assignmentId === entry.assignmentId)
                : null;
              const isLatestSubmission =
                isSubmission &&
                entry.assignmentId &&
                latestSubmissionEntryId[entry.assignmentId] === entry.id;

              return (
                <div key={entry.id}>
                  {showGroupHeader && (
                    <div className="my-3 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {isSubmission ? 'Сданная работа' : 'Вопросы по заданию'}:{' '}
                        {entry.assignment?.title}
                      </span>
                    </div>
                  )}
                  {isSubmission && relatedSa ? (
                    <SubmissionCard
                      entry={entry}
                      sa={relatedSa}
                      studentName={studentName}
                      onAccept={() => handleReview(relatedSa.id, 'reviewed')}
                      onRequestRevision={() => handleReview(relatedSa.id, 'needs_revision')}
                      isReviewing={reviewingId === relatedSa.id}
                      showActions={!!isLatestSubmission}
                    />
                  ) : (
                    <MessageBubble
                      entry={entry}
                      showAuthor={i === 0 || entries[i - 1]!.authorId !== entry.authorId}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <Separator />

      {/* Composer */}
      <div className="flex flex-col gap-2 p-3">
        {showLinkInput && (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Добавить ссылку</span>
              <button
                onClick={() => {
                  setShowLinkInput(false);
                  setLinkUrl('');
                  setLinkTitle('');
                }}
              >
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
            />
            <div className="flex gap-2">
              <Input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Описание (необязательно)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendLink();
                }}
              />
              <Button disabled={sending || !linkUrl.trim()} onClick={handleSendLink}>
                Добавить
              </Button>
            </div>
          </div>
        )}

        {inputMode === 'note' && (
          <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Приватная заметка — ученик не увидит
            </span>
            <button onClick={() => setInputMode('comment')}>
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex gap-1">
            <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Прикрепить файл"
              disabled={sending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
            </Button>
            <Button
              type="button"
              variant={showLinkInput ? 'secondary' : 'ghost'}
              size="icon"
              title="Добавить ссылку"
              disabled={sending}
              onClick={() => {
                setShowLinkInput((v) => !v);
                if (inputMode === 'note') setInputMode('comment');
              }}
            >
              <Link2 />
            </Button>
            <Button
              type="button"
              variant={inputMode === 'note' ? 'secondary' : 'ghost'}
              size="icon"
              title="Приватная заметка"
              onClick={() => setInputMode((m) => (m === 'note' ? 'comment' : 'note'))}
            >
              <StickyNote />
            </Button>
          </div>

          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              inputMode === 'comment' ? 'Комментарий для ученика...' : 'Приватная заметка...'
            }
            rows={1}
            // min-h-10 совпадает с высотой кнопок (size-9 + рамка) и не клиппит
            // одну строку; field-sizing-content авто-растит до max-h-40.
            className="max-h-40 min-h-10 flex-1 resize-none py-2 leading-tight"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />

          <Button type="button" size="icon" disabled={sending || !hasContent} onClick={handleSend}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ entry, showAuthor }: { entry: ThreadEntry; showAuthor: boolean }) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);

  return (
    <div
      className={cn(
        'flex max-w-[85%] items-end gap-2',
        showAuthor ? 'mt-4' : 'mt-1',
        isAdmin ? 'ml-auto flex-row-reverse' : 'mr-auto flex-row',
      )}
    >
      {showAuthor ? (
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials(entry.author.name)}</AvatarFallback>
        </Avatar>
      ) : (
        <div className="w-8 shrink-0" />
      )}

      <div className="min-w-0">
        {showAuthor && (
          <div
            className={cn(
              'mb-1 flex items-center gap-2 text-xs text-muted-foreground',
              isAdmin ? 'justify-end pr-1' : 'justify-start pl-1',
            )}
          >
            <span>{entry.author.name}</span>
            {isNote && <Badge variant="outline">заметка</Badge>}
          </div>
        )}

        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            isNote
              ? 'border-dashed bg-muted/40'
              : isAdmin
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted',
          )}
        >
          <div className="break-words">
            {['text', 'comment', 'note'].includes(entry.type) ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'link' ? (
              <LinkCard entry={entry} />
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
                  <Paperclip className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {entry.metadata?.fileName || entry.content}
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.metadata?.size != null && (
                      <span className="text-xs opacity-80">{formatBytes(entry.metadata.size)}</span>
                    )}
                    {entry.metadata?.url && (
                      <a
                        href={entry.metadata.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline"
                      >
                        <Download className="size-3" />
                        Скачать
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : entry.type === 'audio' ? (
              entry.metadata?.url ? (
                <audio controls src={entry.metadata.url} className="h-9 max-w-full" />
              ) : (
                <span className="opacity-80">Аудиозапись</span>
              )
            ) : null}
          </div>

          <div
            className={cn(
              'mt-1 flex items-center gap-1 text-[10px] opacity-70',
              isAdmin ? 'justify-start' : 'justify-end',
            )}
          >
            <span>{date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
            {isAdmin &&
              (entry.readAt ? <CheckCheck className="size-3" /> : <Check className="size-3" />)}
          </div>
        </div>

        {entry.assignment && (
          <Badge variant="secondary" className="mt-1">
            {entry.assignment.title.length > 30
              ? entry.assignment.title.slice(0, 30) + '...'
              : entry.assignment.title}
          </Badge>
        )}
      </div>
    </div>
  );
}

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
      className="flex items-start gap-3 rounded-md border bg-background p-2 text-foreground no-underline"
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Link2 className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        {title && <div className="truncate text-sm font-medium">{title}</div>}
        <div className="truncate text-xs text-muted-foreground">{url}</div>
      </div>
    </a>
  );
}

function SubmissionCard({
  entry,
  sa,
  studentName,
  onAccept,
  onRequestRevision,
  isReviewing,
  showActions,
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
  const status = SUBMISSION_STATUS[sa.status] ?? { label: sa.status, variant: 'outline' as const };

  return (
    <div className="mt-4 mr-auto max-w-[85%] pl-10">
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            <span className="text-sm font-medium">{entry.assignment?.title}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {date.toLocaleString('ru-RU', { day: 'numeric', month: 'short' })} ·{' '}
            {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className="p-4">
          <div className="mb-2 text-xs text-muted-foreground">Студент: {studentName}</div>

          {sa.content && (
            <div className="mb-3 rounded-md border-l-2 bg-muted/40 p-3">
              <p className="m-0 whitespace-pre-wrap text-sm italic text-muted-foreground">
                {sa.content}
              </p>
            </div>
          )}

          {sa.fileName && (
            <div className="mb-3 flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
                <Paperclip className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{sa.fileName}</div>
                {sa.fileSize && (
                  <span className="text-xs text-muted-foreground">{formatBytes(sa.fileSize)}</span>
                )}
              </div>
              {sa.fileSignedUrl && (
                <a
                  href={sa.fileSignedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline"
                >
                  Открыть
                </a>
              )}
            </div>
          )}

          {showActions && sa.status === 'submitted' && (
            <div className="mt-3 flex gap-2 border-t pt-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onAccept}
                disabled={isReviewing}
              >
                {isReviewing ? <Loader2 className="animate-spin" /> : 'Принять'}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={onRequestRevision}
                disabled={isReviewing}
              >
                {isReviewing ? <Loader2 className="animate-spin" /> : 'На доработке'}
              </Button>
            </div>
          )}

          {(sa.status === 'reviewed' || sa.status === 'needs_revision') && (
            <div className="mt-2 text-xs text-muted-foreground">
              {status.label}
              {sa.reviewedAt && (
                <span className="ml-2">
                  {new Date(sa.reviewedAt).toLocaleString('ru-RU', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
