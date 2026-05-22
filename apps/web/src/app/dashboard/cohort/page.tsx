'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, MessagesSquare, ChevronLeft, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getCohortConversations,
  getCohortConversation,
  addCohortEntry,
  uploadCohortFile,
  type CohortConversationSummary,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StaffConversation, type ConversationSource } from '@/components/staff-conversation';
import { cn } from '@platform/ui/lib/utils';

export default function StudentCohortPage() {
  const { accessToken } = useAuth();

  const [streams, setStreams] = useState<CohortConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const fetchStreams = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { streams: list } = await getCohortConversations(accessToken);
      setStreams(list);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки чатов потоков');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) fetchStreams();
  }, [accessToken, fetchStreams]);

  // Один поток — открываем его ленту сразу, без промежуточного списка.
  useEffect(() => {
    if (!loading && streams.length === 1 && selected === null) {
      setSelected(streams[0]!.streamId);
    }
  }, [loading, streams, selected]);

  const selectedSummary = streams.find((s) => s.streamId === selected);
  const singleStream = streams.length === 1;

  // Источник данных ленты для выбранного потока — функции, привязанные к streamId.
  const source: ConversationSource | null = useMemo(() => {
    if (!selected) return null;
    return {
      load: (token) => getCohortConversation(token, selected),
      send: (token, data) => addCohortEntry(token, selected, data),
      uploadFile: (token, file, type) => uploadCohortFile(token, selected, file, type),
    };
  }, [selected]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="break-all">{error}</AlertDescription>
      </Alert>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <MessagesSquare className="size-10 opacity-40" />
        <p className="text-sm">Вы пока не зачислены ни в один поток</p>
      </div>
    );
  }

  // Один поток — сразу лента на всю высоту.
  if (singleStream && selected && source) {
    return (
      <div className="flex w-full flex-1 flex-col min-h-0">
        <div className="border-b px-1 pb-3">
          <h1 className="text-2xl font-bold tracking-tight">Чат потока</h1>
          <p className="mt-1 text-sm text-muted-foreground">{selectedSummary?.name}</p>
        </div>
        <div className="min-h-0 flex-1">
          <StaffConversation
            key={selected}
            source={source}
            onRead={fetchStreams}
            placeholder="Сообщение в чат потока..."
            emptyText="В чате потока пока нет сообщений"
            loadErrorText="Ошибка загрузки чата потока"
          />
        </div>
      </div>
    );
  }

  // Несколько потоков — список слева, лента справа (как в админке).
  return (
    <div className="flex w-full flex-1 flex-col min-h-0">
      <div className="border-b px-1 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Чат потока</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Общий чат участников вашего потока
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left: stream list */}
        <div
          className={cn(
            'flex w-full flex-col border-b md:w-80 md:shrink-0 md:border-r md:border-b-0 lg:w-96',
            selected && 'hidden md:flex',
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul>
              {streams.map((s) => (
                <li key={s.streamId}>
                  <button
                    onClick={() => setSelected(s.streamId)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent',
                      selected === s.streamId && 'bg-accent',
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
          </div>
        </div>

        {/* Right: selected stream conversation */}
        <div className={cn('min-h-0 flex-1 flex-col', selected ? 'flex' : 'hidden md:flex')}>
          {selected && source ? (
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
                <span className="truncate font-medium">{selectedSummary?.name}</span>
              </div>
              <div className="min-h-0 flex-1">
                <StaffConversation
                  key={selected}
                  source={source}
                  onRead={fetchStreams}
                  placeholder="Сообщение в чат потока..."
                  emptyText="В чате потока пока нет сообщений"
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
    </div>
  );
}
