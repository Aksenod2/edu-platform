'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, MessagesSquare, ChevronLeft, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getThreads,
  getStaffUnread,
  getCohortConversations,
  getCohortConversation,
  addCohortEntry,
  uploadCohortFile,
  type ThreadSummary,
  type CohortConversationSummary,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ThreadConversation } from '@/components/thread-conversation';
import { StaffConversation, type ConversationSource } from '@/components/staff-conversation';
import { cn } from '@platform/ui/lib/utils';

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function relativeTime(iso: string) {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

type Filter = 'all' | 'waiting';

export default function AdminThreadsPage() {
  const { accessToken } = useAuth();

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [staffUnread, setStaffUnread] = useState(0);

  const [cohorts, setCohorts] = useState<CohortConversationSummary[]>([]);
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await getThreads(accessToken);
      setThreads(data.threads);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const fetchStaffUnread = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { unreadCount } = await getStaffUnread(accessToken);
      setStaffUnread(unreadCount);
    } catch {
      // Бейдж штаба не критичен — молча игнорируем ошибку счётчика.
    }
  }, [accessToken]);

  const fetchCohorts = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { streams: list } = await getCohortConversations(accessToken);
      setCohorts(list);
    } catch {
      // Список общих чатов не критичен — молча игнорируем ошибку.
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) {
      fetchThreads();
      fetchStaffUnread();
      fetchCohorts();
    }
  }, [accessToken, fetchThreads, fetchStaffUnread, fetchCohorts]);

  const visible = threads.filter((t) => (filter === 'waiting' ? t.unanswered : true));
  const waitingCount = threads.filter((t) => t.unanswered).length;
  const selectedThread = threads.find((t) => t.studentId === selected);

  const cohortsUnread = cohorts.reduce((sum, s) => sum + s.unreadCount, 0);
  const selectedCohortSummary = cohorts.find((s) => s.streamId === selectedCohort);

  // Источник данных ленты общего чата выбранного потока.
  const cohortSource: ConversationSource | null = useMemo(() => {
    if (!selectedCohort) return null;
    return {
      load: (token) => getCohortConversation(token, selectedCohort),
      send: (token, data) => addCohortEntry(token, selectedCohort, data),
      uploadFile: (token, file, type) => uploadCohortFile(token, selectedCohort, file, type),
    };
  }, [selectedCohort]);

  return (
    <Tabs defaultValue="students" className="-mx-4 -mb-4 flex flex-1 min-h-0 flex-col gap-0 md:mx-0 md:mb-0">
      <div className="border-b px-4 py-3">
        <h1 className="mb-3 text-xl font-bold tracking-tight">Сообщения</h1>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
          <TabsTrigger value="students">Ученики</TabsTrigger>
          <TabsTrigger value="staff">
            Штаб
            {staffUnread > 0 && (
              <Badge variant="destructive" className="ml-1">
                {staffUnread}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="cohorts">
            Чаты потоков
            {cohortsUnread > 0 && (
              <Badge variant="destructive" className="ml-1">
                {cohortsUnread}
              </Badge>
            )}
          </TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent value="students" className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Left: conversation list */}
      <div
        className={cn(
          'flex w-full flex-col border-b md:w-80 md:shrink-0 md:border-r md:border-b-0 lg:w-96',
          selected && 'hidden md:flex',
        )}
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
            >
              Все
            </Button>
            <Button
              size="sm"
              variant={filter === 'waiting' ? 'default' : 'outline'}
              onClick={() => setFilter('waiting')}
            >
              Ждут ответа
              {waitingCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {waitingCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <Alert variant="destructive" className="m-3">
              <AlertDescription className="break-all">{error}</AlertDescription>
            </Alert>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {filter === 'waiting' ? 'Нет диалогов, ждущих ответа' : 'Диалогов пока нет'}
            </p>
          ) : (
            <ul>
              {visible.map((t) => (
                <li key={t.studentId}>
                  <button
                    onClick={() => setSelected(t.studentId)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent',
                      selected === t.studentId && 'bg-accent',
                    )}
                  >
                    <Avatar className="size-9 shrink-0">
                      <AvatarFallback className="text-xs">{initials(t.studentName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{t.studentName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(t.lastEntryAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {t.lastEntryPreview}
                      </p>
                      <div className="mt-1 flex items-center gap-1">
                        {t.unanswered && <Badge variant="destructive">Ждёт ответа</Badge>}
                        {t.unreadCount > 0 && (
                          <Badge variant="secondary">{t.unreadCount}</Badge>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: selected conversation */}
      <div className={cn('min-h-0 flex-1 flex-col', selected ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <>
            {/* Mobile back + header */}
            <div className="flex items-center gap-2 border-b p-3 md:px-4">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setSelected(null)}
              >
                <ChevronLeft />
              </Button>
              <span className="truncate font-medium">{selectedThread?.studentName}</span>
            </div>
            <div className="min-h-0 flex-1">
              <ThreadConversation
                key={selected}
                studentId={selected}
                onReplied={fetchThreads}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessagesSquare className="size-10 opacity-40" />
            <p className="text-sm">Выберите диалог</p>
          </div>
        )}
      </div>
        </div>
      </TabsContent>

      <TabsContent value="staff" className="min-h-0 flex-1">
        <StaffConversation onRead={fetchStaffUnread} />
      </TabsContent>

      <TabsContent value="cohorts" className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col md:flex-row">
          {/* Left: cohort list (все потоки) */}
          <div
            className={cn(
              'flex w-full flex-col border-b md:w-80 md:shrink-0 md:border-r md:border-b-0 lg:w-96',
              selectedCohort && 'hidden md:flex',
            )}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {cohorts.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Нет потоков
                </p>
              ) : (
                <ul>
                  {cohorts.map((s) => (
                    <li key={s.streamId}>
                      <button
                        onClick={() => setSelectedCohort(s.streamId)}
                        className={cn(
                          'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent',
                          selectedCohort === s.streamId && 'bg-accent',
                        )}
                      >
                        <Avatar className="size-9 shrink-0">
                          <AvatarFallback className="text-xs">
                            <Users className="size-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{s.name}</span>
                            {s.unreadCount > 0 && (
                              <Badge variant="secondary" className="shrink-0">
                                {s.unreadCount}
                              </Badge>
                            )}
                          </div>
                          {s.status === 'archived' && (
                            <p className="mt-0.5 text-xs text-muted-foreground">Архив</p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right: selected cohort conversation */}
          <div
            className={cn(
              'min-h-0 flex-1 flex-col',
              selectedCohort ? 'flex' : 'hidden md:flex',
            )}
          >
            {selectedCohort && cohortSource ? (
              <>
                {/* Mobile back + header */}
                <div className="flex items-center gap-2 border-b p-3 md:px-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => setSelectedCohort(null)}
                  >
                    <ChevronLeft />
                  </Button>
                  <span className="truncate font-medium">{selectedCohortSummary?.name}</span>
                </div>
                <div className="min-h-0 flex-1">
                  <StaffConversation
                    key={selectedCohort}
                    source={cohortSource}
                    onRead={fetchCohorts}
                    placeholder="Сообщение в чат потока..."
                    emptyText="В этом чате потока пока нет сообщений"
                    loadErrorText="Ошибка загрузки чата потока"
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <MessagesSquare className="size-10 opacity-40" />
                <p className="text-sm">Выберите поток</p>
              </div>
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
