'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getAssignments,
  getStudentAssignments,
  type Stream,
  type Assignment,
} from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HintCallout } from '@/components/hint-callout';

// Задание со счётчиками сдач: сколько всего и сколько ждёт проверки.
type AssignmentWithCounts = Assignment & {
  submissionsCount: number; // сколько студентов прислали работу (submitted/reviewed/needs_revision)
  pendingCount: number; // сколько работ ждёт проверки (submitted)
};

type StreamWithAssignments = Stream & { assignments: AssignmentWithCounts[] };

const typeLabels: Record<string, string> = {
  short: 'Короткое',
  long: 'Длинное',
};

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
      // Один запрос за всеми сдачами, чтобы посчитать счётчики по заданиям
      // (API заданий отдаёт только общее _count назначений, без статусов).
      const [{ streams }, { studentAssignments }] = await Promise.all([
        getStreams(accessToken),
        getStudentAssignments(accessToken, {}),
      ]);

      // Считаем по каждому заданию: всего сдач (прислали работу) и сколько ждёт проверки.
      const submissions = new Map<string, number>();
      const pending = new Map<string, number>();
      for (const sa of studentAssignments) {
        if (sa.status === 'submitted' || sa.status === 'reviewed' || sa.status === 'needs_revision') {
          submissions.set(sa.assignmentId, (submissions.get(sa.assignmentId) ?? 0) + 1);
        }
        if (sa.status === 'submitted') {
          pending.set(sa.assignmentId, (pending.get(sa.assignmentId) ?? 0) + 1);
        }
      }

      const active = streams.filter((s) => s.status === 'active');
      const withAssignments = await Promise.all(
        active.map(async (stream) => {
          const { assignments } = await getAssignments(accessToken, stream.id);
          return {
            ...stream,
            assignments: assignments.map((a) => ({
              ...a,
              submissionsCount: submissions.get(a.id) ?? 0,
              pendingCount: pending.get(a.id) ?? 0,
            })),
          };
        }),
      );
      // Потоки без заданий не показываем — хаб про проверку, а не про управление потоками.
      setStreamsData(withAssignments.filter((s) => s.assignments.length > 0));
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
  const totalPending = streamsData.reduce(
    (sum, s) => sum + s.assignments.reduce((acc, a) => acc + a.pendingCount, 0),
    0,
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Задания</h1>
          <p className="text-sm text-muted-foreground">
            {loadingData
              ? 'Загрузка...'
              : `Всего заданий: ${totalAssignments}${totalPending > 0 ? ` · на проверке: ${totalPending}` : ''}`}
          </p>
        </div>
      </div>

      <div className="my-4">
        <HintCallout
          storageKey="eduhint:assignments-hub"
          title="Сюда стекаются работы на проверку"
        >
          Список ДЗ по всем группам со счётчиком сдач. Бейдж «На проверке» —
          сколько работ ждёт вас. Нажмите «Проверить», чтобы открыть сдачи.
        </HintCallout>
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
          <p className="text-sm">
            Заданий пока нет. Добавьте задание в группе, чтобы проверять работы студентов.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {streamsData.map((stream) => (
            <div key={stream.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{stream.name}</h2>
                <Badge variant="secondary">{stream.assignments.length}</Badge>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Задание</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Сдач</TableHead>
                      <TableHead>На проверке</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stream.assignments.map((a) => (
                      <TableRow
                        key={a.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/admin/assignments/${a.id}`)}
                      >
                        <TableCell className="font-medium">{a.title}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {typeLabels[a.type] ?? a.type}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {a.submissionsCount}
                        </TableCell>
                        <TableCell>
                          {a.pendingCount > 0 ? (
                            <Badge>{a.pendingCount}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/admin/assignments/${a.id}`);
                            }}
                          >
                            Проверить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
