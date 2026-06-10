'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Loader2,
  X,
  Paperclip,
  Link2,
  Mic,
  Send,
  Square,
  MessageSquare,
  HelpCircle,
  CheckCheck,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { FileLightbox } from '@/components/files/file-lightbox';
import { ChatDateSeparator } from '@/components/chat-date-separator';
import { cn } from '@platform/ui/lib/utils';
import {
  getThread,
  addThreadEntry,
  uploadThreadFile,
  type ThreadEntry,
} from '@/lib/api';
import { usePolling, isNearBottom, mergeById } from '@/lib/chat-realtime';
import { isNewDay } from '@/lib/chat-date';

const POLL_INTERVAL_MS = 5000;

/**
 * Личный тред студента с преподавателем. Вынесен из страницы
 * /dashboard/thread в переиспользуемый компонент, чтобы рендериться внутри
 * таба на /dashboard/messages.
 *
 * Параметры assignmentId / title по-прежнему читаются из query
 * (window.location.search), поведение привязки к заданию сохранено.
 */
export function StudentThreadView() {
  const { user, accessToken } = useAuth();

  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // Прижата ли лента к низу — чтобы поллинг не дёргал скролл при чтении истории.
  const stickToBottom = useRef(true);
  const entriesLenRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    entriesLenRef.current = entries.length;
  }, [entries]);

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
    window.history.replaceState({}, '', url.pathname + url.search);
  };

  const load = useCallback(
    async (silent = false) => {
      if (!accessToken || !user) return;
      if (!silent) setLoadingData(true);
      try {
        const data = await getThread(accessToken, user.id);
        setEntries((prev) => (silent ? mergeById(data.entries, prev) : data.entries));
      } catch (err) {
        if (!silent) toast.error(err instanceof Error ? err.message : 'Ошибка загрузки сообщений');
      } finally {
        if (!silent) setLoadingData(false);
      }
    },
    [accessToken, user],
  );

  useEffect(() => {
    if (accessToken && user?.role === 'student') load(false);
  }, [accessToken, user, load]);

  usePolling(() => load(true), POLL_INTERVAL_MS, !!accessToken && user?.role === 'student');

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = isNearBottom(el);
  };

  // Прокрутка к низу: мгновенно при первой загрузке; при новых сообщениях —
  // только если пользователь у низа (или сам только что отправил).
  useEffect(() => {
    if (loadingData || entries.length === 0) return;
    if (!didInitialScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      didInitialScroll.current = true;
      return;
    }
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, loadingData]);

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
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
      setTextContent('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
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
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
      setLinkUrl('');
      setLinkTitle('');
      setShowLinkInput(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken || !user) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('Файл превышает максимальный размер 50MB'); return; }
    setSending(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, user.id, file, 'file', activeContext?.id);
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла');
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
      toast.error('Нет доступа к микрофону');
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
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
      setAudioBlob(null);
      setRecordingTime(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки аудио');
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

  const hasText = textContent.trim().length > 0;

  return (
    <div className="flex w-full flex-1 flex-col min-h-0">
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col overflow-y-auto px-4 py-4"
      >
        {loadingData ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full border-2 text-muted-foreground">
              <MessageSquare className="size-6" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Пока нет сообщений</p>
            <p className="text-sm text-muted-foreground">Напишите первое сообщение</p>
          </div>
        ) : (
          // mt-auto прижимает ленту к низу: при малом числе сообщений они липнут к полю ввода.
          <div className="mt-auto flex flex-col gap-2">
            {entries.map((entry, i) => {
              const showGroupHeader =
                entry.assignmentId && entry.assignmentId !== entries[i - 1]?.assignmentId;
              return (
                <div key={entry.id}>
                  {isNewDay(entries[i - 1]?.createdAt, entry.createdAt) && (
                    <ChatDateSeparator dateIso={entry.createdAt} />
                  )}
                  {showGroupHeader && (
                    <div className="mb-2 mt-3 flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
                      <HelpCircle className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        Вопросы по заданию: {entry.assignment?.title}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    entry={entry}
                    currentUserId={user?.id ?? ''}
                    showAuthor={i === 0 || entries[i - 1].authorId !== entry.authorId}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Compose bar */}
      <div className="border-t bg-card px-4 py-3">
        {/* Context banner */}
        {activeContext && (
          <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <HelpCircle className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                Вопрос по заданию: {activeContext.title}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={clearActiveContext}
              className="shrink-0 text-muted-foreground"
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        {/* Link panel */}
        {showLinkInput && (
          <div className="mb-3 flex flex-col gap-2 rounded-md border bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Добавить ссылку</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => { setShowLinkInput(false); setLinkUrl(''); setLinkTitle(''); }}
                className="text-muted-foreground"
              >
                <X className="size-4" />
              </Button>
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
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendLink(); }}
              />
              <Button disabled={sending || !linkUrl.trim()} onClick={handleSendLink}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : 'Добавить'}
              </Button>
            </div>
          </div>
        )}

        {/* Audio overlay */}
        {(isRecording || audioBlob) && (
          <div className="mb-3 flex items-center gap-3 rounded-md border bg-muted p-3">
            {isRecording ? (
              <>
                <span className="inline-block size-2 animate-pulse rounded-full bg-destructive" />
                <span className="flex-1 text-sm font-medium text-destructive">
                  {formatTime(recordingTime)}
                </span>
                <Button variant="destructive" size="sm" onClick={stopRecording}>
                  <Square className="size-4" /> Стоп
                </Button>
              </>
            ) : audioBlob ? (
              <>
                <span className="flex-1 text-sm text-muted-foreground">
                  Запись {formatTime(recordingTime)}
                </span>
                <Button variant="outline" size="sm" onClick={cancelAudio}>
                  Отмена
                </Button>
                <Button size="sm" disabled={sending} onClick={sendAudio}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : 'Отправить'}
                </Button>
              </>
            ) : null}
          </div>
        )}

        {/* Main compose row */}
        <div className="flex items-end gap-2">
          <div className="flex gap-1">
            <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
            <Button
              variant="ghost"
              size="icon"
              title="Прикрепить файл"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="text-muted-foreground"
            >
              <Paperclip className="size-5" />
            </Button>
            <Button
              variant={showLinkInput ? 'secondary' : 'ghost'}
              size="icon"
              title="Добавить ссылку"
              onClick={() => setShowLinkInput(!showLinkInput)}
              disabled={sending}
              className={cn(!showLinkInput && 'text-muted-foreground')}
            >
              <Link2 className="size-5" />
            </Button>
            <Button
              variant={isRecording ? 'destructive' : 'ghost'}
              size="icon"
              title="Записать аудио"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={sending || !!audioBlob}
              className={cn(!isRecording && 'text-muted-foreground')}
            >
              <Mic className="size-5" />
            </Button>
          </div>

          <Textarea
            ref={textareaRef}
            value={textContent}
            onChange={handleTextareaChange}
            placeholder="Сообщение..."
            rows={1}
            className="min-h-9 resize-none overflow-hidden"
            style={{ maxHeight: 160 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
          />

          <Button
            size="icon"
            className="shrink-0 rounded-full"
            disabled={sending || !hasText}
            onClick={handleSendText}
          >
            <Send className="size-5" />
          </Button>
        </div>
      </div>
    </div>
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
      className={cn(
        'flex min-w-0 max-w-[85%] items-end gap-2',
        showAuthor ? 'mt-4' : 'mt-1',
        isOwn ? 'ml-auto flex-row-reverse' : 'mr-auto flex-row',
      )}
    >
      {showAuthor ? (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback
            className={cn(
              'text-xs font-bold',
              isAdmin
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="w-8 shrink-0" />
      )}

      <div className="min-w-0">
        {showAuthor && (
          <div
            className={cn(
              'mb-1 text-xs font-medium text-muted-foreground',
              isOwn ? 'pr-2 text-right' : 'pl-2 text-left',
            )}
          >
            {entry.author.name}
            {isAdmin && <span className="ml-2 text-muted-foreground">Преп.</span>}
          </div>
        )}

        <div
          className={cn(
            'rounded-md px-4 py-3',
            isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
          )}
        >
          <div className="break-words text-sm leading-normal">
            {entry.type === 'text' || entry.type === 'comment' || entry.type === 'note' ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'link' ? (
              <LinkCard entry={entry} isOwn={isOwn} />
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border">
                  <FileText className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {entry.metadata?.fileName || entry.content}
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.metadata?.size && (
                      <span className={cn('text-xs', isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                        {(entry.metadata.size / 1024 / 1024).toFixed(1)} МБ
                      </span>
                    )}
                    {entry.metadata?.url && (
                      <FileLightbox
                        fileName={entry.metadata.fileName || entry.content}
                        url={entry.metadata.url}
                        trigger={
                          <button
                            type="button"
                            className="text-xs font-medium underline-offset-2 hover:underline"
                          >
                            Просмотр
                          </button>
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : entry.type === 'audio' ? (
              <div>
                {entry.metadata?.url ? (
                  <audio controls src={entry.metadata.url} className="h-9 max-w-full" />
                ) : (
                  <span className={cn(isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>Аудиозапись</span>
                )}
              </div>
            ) : null}
          </div>

          <div className={cn('mt-1 flex items-center gap-1', isOwn ? 'justify-start' : 'justify-end')}>
            <span className={cn('text-[10px]', isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
              {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isOwn && entry.readAt && (
              <span className="flex items-center gap-0.5 text-[10px] text-primary-foreground/70">
                <CheckCheck className="size-3" />
                Прочитано
              </span>
            )}
          </div>
        </div>

        {entry.assignment && (
          <Badge variant="secondary" className="mt-1 max-w-full gap-1 font-normal">
            <HelpCircle className="size-2.5 shrink-0" />
            <span className="truncate">
              {entry.assignment.title.length > 30 ? entry.assignment.title.slice(0, 30) + '...' : entry.assignment.title}
            </span>
          </Badge>
        )}
      </div>
    </div>
  );
}

/* ─── Link card ─── */
function LinkCard({ entry }: { entry: ThreadEntry; isOwn: boolean }) {
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
      className={cn(
        'flex items-start gap-3 rounded-md border bg-card p-3 text-foreground no-underline transition-colors hover:bg-muted',
      )}
    >
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Link2 className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        {title && <div className="mb-1 truncate text-sm font-medium text-foreground">{title}</div>}
        <div className="truncate text-xs text-muted-foreground">{url}</div>
      </div>
    </a>
  );
}
