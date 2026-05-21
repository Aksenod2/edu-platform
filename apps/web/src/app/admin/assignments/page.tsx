'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getStreams, getAssignments, type Stream, type Assignment } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

type StreamWithAssignments = Stream & { assignments: Assignment[] };

export default function AssignmentsHubPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const [streamsData, setStreamsData] = useState<StreamWithAssignments[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const { streams } = await getStreams(accessToken);
      const active = streams.filter((s) => s.status === 'active');
      const withAssignments = await Promise.all(
        active.map(async (stream) => {
          const { assignments } = await getAssignments(accessToken, stream.id);
          return { ...stream, assignments };
        }),
      );
      setStreamsData(withAssignments);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') fetchData();
  }, [accessToken, user, fetchData]);

  const totalAssignments = streamsData.reduce((sum, s) => sum + s.assignments.length, 0);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Задания</h1>
          <p className="text-sm text-muted-foreground">{`Всего заданий: ${loadingData ? '...' : totalAssignments}`}</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loadingData ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : streamsData.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
          <span className="font-mono text-xs tracking-widest mb-1">ПУСТО</span>
          <p className="text-sm">Нет активных потоков. Создайте поток, чтобы добавлять задания.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                {['Поток', 'Статус', 'Заданий', 'Действия'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-muted-foreground font-mono text-xs uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streamsData.map((stream) => (
                <tr key={stream.id} className="border-b hover:bg-card transition-colors">
                  <td className="px-4 py-3 text-foreground font-medium">{stream.name}</td>
                  <td className="px-4 py-3"><Badge>Активный</Badge></td>
                  <td className="px-4 py-3"><span className="font-mono text-xs text-muted-foreground">{stream.assignments.length}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => router.push(`/admin/streams/${stream.id}/assignments`)}>
                        Управление
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
