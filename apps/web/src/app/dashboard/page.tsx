'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Layers,
  ClipboardCheck,
  Bell,
  CalendarDays,
  ChevronRight,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Clock,
  Video,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getStudentAssignments,
  getNotifications,
  getLessons,
  getProfile,
  type Stream,
  type StudentAssignment,
  type Lesson,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudentOnboarding } from '@/components/student-onboarding';

// Ближайшее занятие = урок с датой и статусом «Запланирован».
type ScheduleItem = Lesson & { streamName: string };

/** Дата "YYYY-MM-DD" в человекочитаемом виде (без UTC-сдвига). */
function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  });
}

/** Локальная дата из "YYYY-MM-DD" (без UTC-сдвига). */
function parseLocalDate(date: string): Date {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

function formatRelative(date: string): string {
  // Поддержка как ISO-строк (дедлайны), так и дат "YYYY-MM-DD" (уроки).
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date.slice(0, 10)) && date.length <= 10
    ? parseLocalDate(date)
    : new Date(date);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
  href,
  children,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: React.ReactNode;
}) {
  const card = (
    <Card className={href ? 'h-full transition-colors hover:bg-accent' : 'h-full'}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        {children}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="no-underline">
        {card}
      </Link>
    );
  }
  return card;
}

function AttentionRow({ name, detail, href }: { name: string; detail: string; href: string }) {
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

interface DashboardData {
  activeStreams: number;
  submittedCount: number;
  totalAssignments: number;
  unreadCount: number;
  lessonsNext7Days: number;
  nextLessonDate: string | null;
  overdue: StudentAssignment[];
  needsRevision: StudentAssignment[];
  awaitingReview: StudentAssignment[];
  upcoming: ScheduleItem[];
  questionnaireCompleted: boolean;
}

export default function DashboardPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role === 'student' && user.questionnaireCompleted === false) {
      router.push('/dashboard/profile');
    }
  }, [user, router]);

  useEffect(() => {
    if (!accessToken || !user) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { streams } = await getStreams(accessToken);
        const activeStreams = streams.filter((s: Stream) => s.status === 'active');

        const [saData, notifData, profileData, lessonResults] = await Promise.all([
          getStudentAssignments(accessToken),
          getNotifications(accessToken),
          getProfile(accessToken, user.id),
          Promise.all(activeStreams.map((s) => getLessons(accessToken, s.id))),
        ]);

        if (cancelled) return;

        const assignments = saData.studentAssignments;
        const now = new Date();
        const in7Days = new Date(now);
        in7Days.setDate(in7Days.getDate() + 7);

        const submittedCount = assignments.filter(
          (sa) => sa.status === 'submitted' || sa.status === 'reviewed',
        ).length;

        const overdue = assignments.filter((sa) => {
          const due = sa.assignment?.dueDate;
          return due != null && new Date(due) < now && sa.status !== 'reviewed';
        });
        const needsRevision = assignments.filter((sa) => sa.status === 'needs_revision');
        const awaitingReview = assignments.filter((sa) => sa.status === 'submitted');

        const upcoming: ScheduleItem[] = lessonResults
          .flatMap((res, i) => {
            const stream = activeStreams[i]!;
            return res.lessons.map((l) => ({
              ...l,
              streamName: l.stream?.name ?? stream.name,
            }));
          })
          // Ближайшие занятия — запланированные уроки с датой, начиная с сегодня.
          .filter(
            (l): l is ScheduleItem & { date: string } =>
              l.status === 'planned' &&
              l.date != null &&
              parseLocalDate(l.date) >= startOfDay(now),
          )
          .sort((a, b) => compareSchedule(a, b));

        const lessonsNext7Days = upcoming.filter((e) => {
          const d = parseLocalDate(e.date!);
          return d >= startOfDay(now) && d <= in7Days;
        }).length;

        setData({
          activeStreams: activeStreams.length,
          submittedCount,
          totalAssignments: assignments.length,
          unreadCount: notifData.unreadCount,
          lessonsNext7Days,
          nextLessonDate: upcoming[0]?.date ?? null,
          overdue,
          needsRevision,
          awaitingReview,
          upcoming: upcoming.slice(0, 5),
          questionnaireCompleted: profileData.profile?.questionnaireCompletedAt != null,
        });
        setError('');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, user]);

  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Привет, {firstName}!</h1>
        <p className="text-sm text-muted-foreground">Ваш прогресс на сегодня</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : data ? (
        <>
          {/* Онбординг — чек-лист «Первые шаги» (исчезает, когда пройден/скрыт) */}
          {user && (
            <StudentOnboarding
              userId={user.id}
              questionnaireCompleted={data.questionnaireCompleted}
              hasSubmitted={data.submittedCount > 0}
            />
          )}

          {/* KPI strip */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Мои группы"
              value={data.activeStreams}
              hint="активных групп"
              icon={Layers}
              href="/dashboard/lessons"
            />
            <KpiCard
              title="Заданий сдано"
              value={`${data.submittedCount} / ${data.totalAssignments}`}
              icon={ClipboardCheck}
              href="/dashboard/assignments"
            >
              <Progress
                className="mt-2"
                value={
                  data.totalAssignments > 0
                    ? Math.round((data.submittedCount / data.totalAssignments) * 100)
                    : 0
                }
              />
            </KpiCard>
            <KpiCard
              title="Непрочитанные уведомления"
              value={data.unreadCount}
              hint={data.unreadCount > 0 ? 'требуют внимания' : 'всё прочитано'}
              icon={Bell}
            />
            <KpiCard
              title="Занятий за 7 дней"
              value={data.lessonsNext7Days}
              hint={
                data.nextLessonDate
                  ? `ближайшее ${formatRelative(data.nextLessonDate)}`
                  : 'занятий не запланировано'
              }
              icon={CalendarDays}
              href="/dashboard/schedule"
            />
          </div>

          {/* Two-column area */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* LEFT: requires attention */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Требует внимания</CardTitle>
                <CardDescription>Задания, ожидающие ваших действий</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {data.overdue.length === 0 &&
                data.needsRevision.length === 0 &&
                data.awaitingReview.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                    <CheckCircle2 className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium">Всё под контролем</p>
                    <p className="text-xs text-muted-foreground">
                      Просроченных и ожидающих заданий нет
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Просрочено */}
                    <div className="flex flex-col gap-1">
                      <SectionHeader
                        icon={AlertTriangle}
                        title="Просрочено"
                        count={data.overdue.length}
                      />
                      <div className="mt-1 flex flex-col">
                        {data.overdue.length === 0 ? (
                          <p className="px-2 py-1 text-sm text-muted-foreground">Нет</p>
                        ) : (
                          data.overdue.map((sa) => (
                            <AttentionRow
                              key={sa.id}
                              name={sa.assignment?.title ?? 'Задание'}
                              detail={detailWithDue(sa, 'Дедлайн')}
                              href={`/dashboard/assignments/${sa.id}`}
                            />
                          ))
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* На доработке */}
                    <div className="flex flex-col gap-1">
                      <SectionHeader
                        icon={RotateCcw}
                        title="На доработке"
                        count={data.needsRevision.length}
                      />
                      <div className="mt-1 flex flex-col">
                        {data.needsRevision.length === 0 ? (
                          <p className="px-2 py-1 text-sm text-muted-foreground">Нет</p>
                        ) : (
                          data.needsRevision.map((sa) => (
                            <AttentionRow
                              key={sa.id}
                              name={sa.assignment?.title ?? 'Задание'}
                              detail={detailWithStream(sa)}
                              href={`/dashboard/assignments/${sa.id}`}
                            />
                          ))
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Ожидают проверки */}
                    <div className="flex flex-col gap-1">
                      <SectionHeader
                        icon={Clock}
                        title="Ожидают проверки"
                        count={data.awaitingReview.length}
                      />
                      <div className="mt-1 flex flex-col">
                        {data.awaitingReview.length === 0 ? (
                          <p className="px-2 py-1 text-sm text-muted-foreground">Нет</p>
                        ) : (
                          data.awaitingReview.map((sa) => (
                            <AttentionRow
                              key={sa.id}
                              name={sa.assignment?.title ?? 'Задание'}
                              detail={
                                sa.submittedAt
                                  ? `Отправлено · ${formatRelative(sa.submittedAt)}`
                                  : detailWithStream(sa)
                              }
                              href={`/dashboard/assignments/${sa.id}`}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* RIGHT: upcoming schedule + profile */}
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Ближайшие занятия</CardTitle>
                  <CardDescription>Следующие 5 по всем группам</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Нет запланированных занятий</p>
                  ) : (
                    data.upcoming.map((e) => (
                      <div key={e.id} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{e.title}</span>
                          <Badge variant="outline" className="shrink-0">
                            {e.streamName}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CalendarDays className="size-3" />
                          <span className="tabular-nums">
                            {e.date ? formatDate(e.date) : ''}
                            {e.startTime ? ` · ${e.startTime}` : ''}
                          </span>
                          {e.meetingUrl && (
                            <a
                              href={e.meetingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
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
                  <CardTitle>Профиль</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.questionnaireCompleted ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        <CheckCircle2 className="size-3" />
                        Анкета заполнена
                      </Badge>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Заполните анкету, чтобы преподаватель лучше узнал вас.
                        </p>
                      </div>
                      <Button asChild size="sm" className="w-full">
                        <Link href="/dashboard/profile">Заполнить анкету</Link>
                      </Button>
                    </div>
                  )}
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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function compareSchedule(a: ScheduleItem, b: ScheduleItem): number {
  const byDate = (a.date ?? '').slice(0, 10).localeCompare((b.date ?? '').slice(0, 10));
  if (byDate !== 0) return byDate;
  return (a.startTime ?? '').localeCompare(b.startTime ?? '');
}

function detailWithStream(sa: StudentAssignment): string {
  return sa.assignment?.stream?.name ?? 'Задание';
}

function detailWithDue(sa: StudentAssignment, label: string): string {
  const due = sa.assignment?.dueDate;
  const stream = sa.assignment?.stream?.name;
  const duePart = due ? `${label} ${formatRelative(due)}` : '';
  if (stream && duePart) return `${stream} · ${duePart}`;
  return duePart || stream || 'Задание';
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
        <div className="flex flex-col gap-4">
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
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
