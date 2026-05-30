'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  ClipboardCheck,
  CalendarDays,
  Layers,
  ChevronRight,
  Loader2,
  MessageSquare,
  UserPlus,
  Video,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getAdminStats, type AdminStats } from '@/lib/api';
import { STATUS_LABELS, STATUS_ORDER } from '@/lib/assignment-status';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { HintCallout } from '@/components/hint-callout';

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  });
}

function formatRelative(date: string): string {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function AttentionRow({
  name,
  detail,
  href,
}: {
  name: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-md px-2 py-2 no-underline transition-colors hover:bg-accent"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
      {count > 0 && <Badge variant="secondary">{count}</Badge>}
    </div>
  );
}

export default function AdminPage() {
  const { accessToken } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLoading(true);
    getAdminStats(accessToken)
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Панель управления</h1>
        <p className="text-sm text-muted-foreground">
          Ключевые метрики, задачи на проверку и ближайшие занятия
        </p>
      </div>

      <HintCallout storageKey="eduhint:intro-model" title="Как устроена платформа">
        Коротко о модели: урок — переиспользуемый блок с контентом и ДЗ (живёт в
        копилке); группа — это набор студентов; расписание — когда урок проводят
        конкретной группе. Один урок можно вести в нескольких группах.
      </HintCallout>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : stats ? (
        <>
          {/* KPI strip */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Активные студенты"
              value={stats.students.active}
              hint={`+${stats.students.newThisWeek} новых за неделю`}
              icon={Users}
            />
            <KpiCard
              title="Работ на проверке"
              value={stats.assignments.awaitingReview}
              hint="ожидают вашей оценки"
              icon={ClipboardCheck}
            />
            <KpiCard
              title="Занятий на этой неделе"
              value={stats.schedule.thisWeek}
              hint="в ближайшие 7 дней"
              icon={CalendarDays}
            />
            <KpiCard
              title="Активные группы"
              value={stats.streams.active}
              hint={`${stats.streams.archived} в архиве`}
              icon={Layers}
            />
          </div>

          {/* Two-column area */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* LEFT: requires attention */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Требует внимания</CardTitle>
                <CardDescription>
                  Задачи, ожидающие действий преподавателя
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {/* На проверке */}
                <div className="flex flex-col gap-1">
                  <SectionHeader
                    icon={ClipboardCheck}
                    title="На проверке"
                    count={stats.attention.submissionsToReview.length}
                  />
                  <div className="mt-1 flex flex-col">
                    {stats.attention.submissionsToReview.length === 0 ? (
                      <p className="px-2 py-1 text-sm text-muted-foreground">Нет</p>
                    ) : (
                      stats.attention.submissionsToReview.map((s) => (
                        <AttentionRow
                          key={s.studentAssignmentId}
                          name={s.studentName}
                          detail={`${s.assignmentTitle}${s.submittedAt ? ` · ${formatRelative(s.submittedAt)}` : ''}`}
                          href={`/admin/students/${s.studentId}`}
                        />
                      ))
                    )}
                  </div>
                </div>

                <Separator />

                {/* Сообщения без ответа */}
                <div className="flex flex-col gap-1">
                  <SectionHeader
                    icon={MessageSquare}
                    title="Сообщения без ответа"
                    count={stats.attention.unansweredThreads.length}
                  />
                  <div className="mt-1 flex flex-col">
                    {stats.attention.unansweredThreads.length === 0 ? (
                      <p className="px-2 py-1 text-sm text-muted-foreground">Нет</p>
                    ) : (
                      stats.attention.unansweredThreads.map((t) => (
                        <AttentionRow
                          key={t.studentId}
                          name={t.studentName}
                          detail={`Ждёт ответа · ${formatRelative(t.lastEntryAt)}`}
                          href={`/admin/students/${t.studentId}?tab=thread`}
                        />
                      ))
                    )}
                  </div>
                </div>

                <Separator />

                {/* Онбординг завис */}
                <div className="flex flex-col gap-1">
                  <SectionHeader
                    icon={UserPlus}
                    title="Онбординг завис"
                    count={stats.attention.onboarding.length}
                  />
                  <div className="mt-1 flex flex-col">
                    {stats.attention.onboarding.length === 0 ? (
                      <p className="px-2 py-1 text-sm text-muted-foreground">Нет</p>
                    ) : (
                      stats.attention.onboarding.map((o) => (
                        <AttentionRow
                          key={o.studentId}
                          name={o.studentName}
                          detail={
                            o.reason === 'invite_pending'
                              ? 'Приглашение не принято'
                              : 'Анкета не заполнена'
                          }
                          href={`/admin/students/${o.studentId}`}
                        />
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* RIGHT: upcoming schedule + status bars */}
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Ближайшие занятия</CardTitle>
                  <CardDescription>Следующие 5 по всем группам</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {stats.schedule.upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Нет запланированных занятий</p>
                  ) : (
                    stats.schedule.upcoming.map((e) => (
                      <div key={e.id} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-medium" title={e.lessonTitle}>
                            {e.lessonTitle}
                          </span>
                          <Badge variant="outline" className="shrink-0">
                            {e.streamName}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <CalendarDays className="size-3 shrink-0" />
                          <span className="tabular-nums">
                            {formatDate(e.date)} · {e.startTime}
                          </span>
                          {e.meetingUrl && (
                            <a
                              href={e.meetingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                            >
                              <Video className="size-3" />
                              Подключиться
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Задания по статусам</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <StatusBars byStatus={stats.assignments.byStatus} />
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Загрузка...
        </div>
      )}
    </div>
  );
}

function StatusBars({
  byStatus,
}: {
  byStatus: AdminStats['assignments']['byStatus'];
}) {
  const order = STATUS_ORDER;
  // reviewed («Принято») — акцент; остальные статусы нейтральные оттенки foreground.
  const fills: Record<string, string> = {
    assigned: 'bg-foreground/30',
    submitted: 'bg-foreground/30',
    reviewed: 'bg-primary',
    needs_revision: 'bg-foreground/15',
  };
  const total = order.reduce((sum, key) => sum + byStatus[key], 0);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">Заданий пока нет</p>;
  }

  return (
    <>
      {order.map((key) => {
        const count = byStatus[key];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{STATUS_LABELS[key]}</span>
              <Badge variant="outline" className="tabular-nums">
                {count}
              </Badge>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${fills[key]}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
