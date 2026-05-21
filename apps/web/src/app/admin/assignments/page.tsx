'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getStreams, getAssignments, type Stream, type Assignment } from '@/lib/api';
import { PageHeader } from '@platform/ui/templates';
import { Button, Badge, Spinner, Mono } from '@platform/ui/atoms';

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
      <PageHeader
        title="Задания"
        subtitle={`Всего заданий: ${loadingData ? '...' : totalAssignments}`}
      />

      {error && (
        <div className="px-4 py-3 mb-4 rounded-[var(--radius-xs)] border border-[var(--color-error)] bg-[var(--color-error-dim)] text-[var(--color-error)] text-sm">
          {error}
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : streamsData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Mono size="xs" className="text-[var(--color-text-tertiary)] tracking-[var(--tracking-widest)] mb-3">ПУСТО</Mono>
          <p className="text-[var(--color-text-tertiary)] text-sm">Нет активных потоков. Создайте поток, чтобы добавлять задания.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                {['Поток', 'Статус', 'Заданий', 'Действия'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[var(--color-text-tertiary)] font-mono text-xs uppercase tracking-[var(--tracking-wider)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streamsData.map((stream) => (
                <tr key={stream.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface)] transition-colors">
                  <td className="px-4 py-3 text-[var(--color-text-primary)] font-medium">{stream.name}</td>
                  <td className="px-4 py-3"><Badge variant="success">Активный</Badge></td>
                  <td className="px-4 py-3"><Mono size="xs" className="text-[var(--color-text-secondary)]">{stream.assignments.length}</Mono></td>
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
