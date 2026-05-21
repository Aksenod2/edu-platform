'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LessonsManager } from '@/components/lessons-manager';
import { getStreams, type Stream } from '@/lib/api';

export default function AdminLessonsPage() {
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStreams = useCallback(async () => {
    if (!accessToken || !user || user.role !== 'admin') return;
    setLoading(true);
    try {
      const { streams: allStreams } = await getStreams(accessToken);
      setStreams(allStreams);
      setSelectedStreamId((prev) => {
        if (prev && allStreams.some((s) => s.id === prev)) return prev;
        const active = allStreams.find((s) => s.status !== 'archived');
        return active?.id ?? allStreams[0]?.id ?? '';
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков');
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    fetchStreams();
  }, [fetchStreams]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Уроки</h1>
          <p className="text-sm text-muted-foreground">Управление уроками по потокам</p>
        </div>
        {streams.length > 0 && (
          <Select value={selectedStreamId} onValueChange={setSelectedStreamId}>
            <SelectTrigger className="w-full max-w-[220px]">
              <SelectValue placeholder="Поток" />
            </SelectTrigger>
            <SelectContent>
              {streams.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.status === 'archived' ? '(архив)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : streams.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Потоков пока нет. Создайте поток, чтобы добавлять уроки.
        </p>
      ) : selectedStreamId ? (
        <LessonsManager streamId={selectedStreamId} />
      ) : null}
    </div>
  );
}
