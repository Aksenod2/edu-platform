'use client';

import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2, Paperclip, Link2, Send, X, Eye } from 'lucide-react';
import {
  getStaffConversation,
  addStaffEntry,
  uploadStaffFile,
  type StaffEntry,
  type ThreadEntryType,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { FileLightbox } from '@/components/files/file-lightbox';
import { ChatDateSeparator } from '@/components/chat-date-separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cn } from '@platform/ui/lib/utils';
import { usePolling, isNearBottom, mergeById } from '@/lib/chat-realtime';
import { isNewDay } from '@/lib/chat-date';

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

/**
 * Источник данных ленты — позволяет одному компоненту обслуживать и штаб,
 * и пер-поточный чат. Функции уже привязаны к нужному endpoint/streamId
 * вызывающей стороной; токен передаётся отдельным аргументом.
 */
export interface ConversationSource {
  /** Загрузить ленту (открытие = прочтение на бэкенде). */
  load: (accessToken: string) => Promise<{ entries: StaffEntry[] }>;
  /** Отправить текст/ссылку. */
  send: (
    accessToken: string,
    data: { type: ThreadEntryType; content: string; metadata?: Record<string, unknown> },
  ) => Promise<{ entry: StaffEntry }>;
  /** Загрузить файл/аудио. */
  uploadFile: (
    accessToken: string,
    file: File,
    type: 'file' | 'audio',
  ) => Promise<{ entry: StaffEntry }>;
}

// Источник по умолчанию — штаб-канал.
const STAFF_SOURCE: ConversationSource = {
  load: (token) => getStaffConversation(token),
  send: (token, data) => addStaffEntry(token, data),
  uploadFile: (token, file, type) => uploadStaffFile(token, file, type),
};

/**
 * Лента группового канала преподавателей (штаб или пер-поточный чат) с inline-композером.
 * Лёгкий аналог ThreadConversation без студент-специфики (сдачи/ревью).
 *
 * По умолчанию обслуживает штаб-канал. Для пер-поточного чата передайте `source`
 * с функциями, привязанными к конкретному потоку, плюс `placeholder`/`emptyText`.
 */
export function StaffConversation({
  onRead,
  source = STAFF_SOURCE,
  placeholder = 'Сообщение в штаб...',
  emptyText = 'В штабе пока нет сообщений',
  loadErrorText = 'Ошибка загрузки штаба',
}: {
  onRead?: () => void;
  source?: ConversationSource;
  placeholder?: string;
  emptyText?: string;
  loadErrorText?: string;
}) {
  const { accessToken, user } = useAuth();
  const myId = user?.id ?? '';

  const [entries, setEntries] = useState<StaffEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const [content, setContent] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // Прижата ли лента к низу — если пользователь прокрутил историю вверх, не
  // дёргаем его скролл при поллинге новых сообщений.
  const stickToBottom = useRef(true);
  const entriesLenRef = useRef(0);
  useEffect(() => {
    entriesLenRef.current = entries.length;
  }, [entries]);

  const load = useCallback(
    async (silent = false) => {
      if (!accessToken) return;
      if (!silent) setLoading(true);
      try {
        const data = await source.load(accessToken);
        const prevLen = entriesLenRef.current;
        setEntries((prev) => (silent ? mergeById(data.entries, prev) : data.entries));
        setError('');
        // Открытие/новые сообщения сбросили непрочитанное на бэкенде — обновим бейдж.
        if (!silent || data.entries.length > prevLen) onRead?.();
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : loadErrorText);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [accessToken, onRead, source, loadErrorText],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  usePolling(() => load(true), POLL_INTERVAL_MS);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = isNearBottom(el);
  };

  // Прокрутка к низу: мгновенно при первой загрузке; при новых сообщениях —
  // только если пользователь и так у низа (или сам только что отправил).
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

  const handleSend = async () => {
    if (!accessToken || !content.trim()) return;
    setSending(true);
    try {
      const { entry } = await source.send(accessToken, {
        type: 'text',
        content: content.trim(),
      });
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
      setContent('');
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
      const { entry } = await source.send(accessToken, {
        type: 'link',
        content: linkUrl.trim(),
        ...(linkTitle.trim() ? { metadata: { title: linkTitle.trim() } } : {}),
      });
      stickToBottom.current = true;
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
    if (!file || !accessToken) return;
    if (file.size > 50 * 1024 * 1024) {
      setError('Файл превышает максимальный размер 50MB');
      return;
    }
    setSending(true);
    try {
      const { entry } = await source.uploadFile(accessToken, file, 'file');
      stickToBottom.current = true;
      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          </div>
        ) : (
          <div className="mt-auto flex flex-col gap-2">
            {entries.map((entry, i) => (
              <Fragment key={entry.id}>
                {isNewDay(entries[i - 1]?.createdAt, entry.createdAt) && (
                  <ChatDateSeparator dateIso={entry.createdAt} />
                )}
                <StaffMessageBubble
                  entry={entry}
                  isOwn={entry.authorId === myId}
                  showAuthor={i === 0 || entries[i - 1]!.authorId !== entry.authorId}
                />
              </Fragment>
            ))}
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
              onClick={() => setShowLinkInput((v) => !v)}
            >
              <Link2 />
            </Button>
          </div>

          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            rows={1}
            className="max-h-40 min-h-9 flex-1 resize-none"
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

function StaffMessageBubble({
  entry,
  isOwn,
  showAuthor,
}: {
  entry: StaffEntry;
  isOwn: boolean;
  showAuthor: boolean;
}) {
  const date = new Date(entry.createdAt);

  return (
    <div
      className={cn(
        'flex max-w-[85%] items-end gap-2',
        showAuthor ? 'mt-4' : 'mt-1',
        isOwn ? 'ml-auto flex-row-reverse' : 'mr-auto flex-row',
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
              isOwn ? 'justify-end pr-1' : 'justify-start pl-1',
            )}
          >
            <span>{entry.author.name}</span>
          </div>
        )}

        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted',
          )}
        >
          <div className="break-words">
            {entry.type === 'text' ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'link' ? (
              <StaffLinkCard entry={entry} />
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
                  <Paperclip className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {entry.metadata?.fileName || entry.content}
                  </div>
                  <div className="flex items-center gap-2">
                    {entry.metadata?.size != null && (
                      <span className="text-xs opacity-80">{formatBytes(entry.metadata.size)}</span>
                    )}
                    {entry.metadata?.url && (
                      <FileLightbox
                        fileName={entry.metadata.fileName || entry.content}
                        url={entry.metadata.url}
                        trigger={
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs underline"
                          >
                            <Eye className="size-3" />
                            Просмотр
                          </button>
                        }
                      />
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
              isOwn ? 'justify-start' : 'justify-end',
            )}
          >
            <span>{date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffLinkCard({ entry }: { entry: StaffEntry }) {
  const url = entry.content;
  const title = entry.metadata?.title as string | undefined;

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
