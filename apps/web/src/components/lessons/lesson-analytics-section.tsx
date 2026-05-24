'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@platform/ui/lib/utils';
import { getLessonAnalytics, type LessonAnalytics } from '@/lib/api';

// Один счётчик-плитка в духе Google Classroom: крупное число + понятная подпись.
function StatTile({
  value,
  label,
  tone = 'default',
}: {
  value: number;
  label: string;
  tone?: 'default' | 'positive' | 'attention' | 'muted';
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <span
        className={cn(
          'text-3xl font-bold tabular-nums leading-none',
          tone === 'positive' && 'text-primary',
          tone === 'attention' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Блок «Статистика сдач» во View Mode урока: счётчики по занятию (Session =
 * lessonId × streamId) из getLessonAnalytics. Модель Google Classroom — число +
 * подпись, без тяжёлых графиков. Состояния: загрузка / нет данных / ошибка.
 *
 * assignmentId (если ДЗ выдано) даёт ссылку «Проверить сдачи» в админ-задание.
 */
export function LessonAnalyticsSection({
  accessToken,
  lessonId,
  streamId,
  assignmentId,
}: {
  accessToken: string;
  lessonId: string;
  streamId: string;
  assignmentId?: string | null;
}) {
  const [data, setData] = useState<LessonAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 404 = занятия (Session) по этому потоку нет → это не ошибка, а «нет данных».
  const [noSession, setNoSession] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setNoSession(false);
    try {
      const res = await getLessonAnalytics(accessToken, lessonId, streamId);
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка загрузки статистики';
      // 404 транслируется как «Ресурс не найден» — занятия нет, показываем заглушку.
      if (msg.includes('не найден')) {
        setNoSession(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, lessonId, streamId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-5 shrink-0 text-muted-foreground" />
            Статистика сдач
          </CardTitle>
          {/* Ссылка на проверку сдач — только если ДЗ выдано (есть assignmentId). */}
          {assignmentId && !error && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/assignments/${assignmentId}`}>
                <ClipboardCheck className="size-4" />
                Проверить сдачи
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 rounded-md border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{error}</span>
            </p>
            <Button size="sm" variant="outline" onClick={load} className="w-full sm:w-auto">
              <RefreshCw className="size-4" />
              Повторить
            </Button>
          </div>
        ) : noSession || !data ? (
          <p className="text-sm text-muted-foreground">
            Статистика появится, когда урок будет запланирован занятием в этой группе.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile value={data.submittedCount} label="Сдали" tone="positive" />
              <StatTile value={data.notSubmittedCount} label="Не сдали" tone="muted" />
              <StatTile
                value={data.pendingReviewCount}
                label="На проверке"
                tone={data.pendingReviewCount > 0 ? 'attention' : 'default'}
              />
              <StatTile value={data.enrolledCount} label="Всего в группе" />
            </div>

            {/* Прогресс сдачи: доля сдавших от состава группы. */}
            {data.enrolledCount > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    Сдали {data.submittedCount} из {data.enrolledCount}
                  </span>
                  <span className="tabular-nums">
                    {Math.round((data.submittedCount / data.enrolledCount) * 100)}%
                  </span>
                </div>
                <Progress
                  value={(data.submittedCount / data.enrolledCount) * 100}
                  className="h-2"
                />
              </div>
            )}

            {/* Подсказка-итог: если все проверено — спокойный позитивный статус. */}
            {data.pendingReviewCount === 0 && data.submittedCount > 0 && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-primary" />
                Все присланные работы проверены.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
