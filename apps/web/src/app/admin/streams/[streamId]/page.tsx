'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  Loader2,
  Users,
  BookOpen,
  ClipboardList,
  CalendarDays,
  CalendarPlus,
  Plus,
  Trash2,
  Search,
  UserPlus,
  ExternalLink,
  CalendarX,
  Send,
  Wallet,
  Undo2,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/back-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/user-avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ScheduleCalendar,
  type CalendarLesson,
  type CalendarUpdateData,
} from '@/components/schedule-calendar';
import {
  getStream,
  getStreamStudents,
  enrollStudents,
  unenrollStudent,
  getStudents,
  getLessons,
  updateLesson,
  unscheduleLesson,
  getAssignments,
  createAssignment,
  deleteAssignment,
  getTeachers,
  updateStream,
  getStreamCharges,
  refundCharge,
  formatKopecks,
  rublesToKopecks,
  kopecksToRublesInput,
  BILLING_TYPE_LABELS,
  type StreamWithCounts,
  type Student,
  type Teacher,
  type Lesson,
  type Assignment,
  type StreamChargeRow,
  type StreamChargePaymentStatus,
  type StreamBillingType,
} from '@/lib/api';
import { HintCallout } from '@/components/hint-callout';
import { InviteLinkDialog } from '@/components/invite-link-dialog';
import { PlanEventDialog } from '@/components/schedule/plan-event-dialog';
import { SessionStatusControl } from '@/components/schedule/session-status-control';

// Допустимые значения вкладок (для синхронизации с ?tab= в URL).
const TAB_VALUES = ['overview', 'students', 'lessons', 'assignments', 'schedule'];

export default function StreamDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const streamId = params.streamId as string;
  const { user, accessToken } = useAuth();

  // Активная вкладка управляется через ?tab= — это позволяет вести на конкретную
  // вкладку ссылками (например из списка потоков «Уроки»/«Задания»).
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam && TAB_VALUES.includes(tabParam) ? tabParam : 'overview';

  const handleTabChange = (value: string) => {
    const query = new URLSearchParams(searchParams.toString());
    query.set('tab', value);
    router.replace(`/admin/streams/${streamId}?${query.toString()}`, { scroll: false });
  };

  const [stream, setStream] = useState<StreamWithCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStream = useCallback(async () => {
    if (!accessToken || !streamId) return;
    setLoading(true);
    try {
      const { stream } = await getStream(accessToken, streamId);
      setStream(stream);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки группы');
    } finally {
      setLoading(false);
    }
  }, [accessToken, streamId]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchStream();
    }
  }, [accessToken, user, fetchStream]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="flex flex-col gap-6">
        <BackButton fallbackHref="/admin/streams" />
        <Alert variant="destructive">
          <AlertDescription>{error || 'Группа не найдена'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackButton fallbackHref="/admin/streams" />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{stream.name}</h1>
          {stream.status === 'active' ? (
            <Badge>Активный</Badge>
          ) : (
            <Badge variant="outline">Архивный</Badge>
          )}
          <BillingTypeBadge billingType={stream.billingType ?? 'one_time'} />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="-m-1.5 overflow-x-auto p-1.5">
          <TabsList>
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="students">Студенты</TabsTrigger>
            <TabsTrigger value="lessons">Уроки</TabsTrigger>
            <TabsTrigger value="assignments">Задания</TabsTrigger>
            <TabsTrigger value="schedule">Расписание</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            stream={stream}
            onOwnerChange={fetchStream}
            onGoToSchedule={() => handleTabChange('schedule')}
          />
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          <StudentsTab
            streamId={streamId}
            streamName={stream.name}
            onRosterChange={fetchStream}
          />
        </TabsContent>

        <TabsContent value="lessons" className="mt-4">
          <LessonsTab stream={stream} />
        </TabsContent>

        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab streamId={streamId} />
        </TabsContent>

        <TabsContent value="schedule" className="mt-4">
          <ScheduleTab stream={stream} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ScheduleTab({ stream }: { stream: StreamWithCounts }) {
  const { accessToken } = useAuth();

  const [lessons, setLessons] = useState<CalendarLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const lessonsData = await getLessons(accessToken, stream.id);
      setLessons(
        lessonsData.lessons.map((l) => ({
          ...l,
          streamName: stream.name,
        })),
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки расписания');
    } finally {
      setLoading(false);
    }
  }, [accessToken, stream.id, stream.name]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleUpdate = async (id: string, data: CalendarUpdateData) => {
    if (!accessToken) return;
    try {
      await updateLesson(accessToken, id, {
        // Новая модель: расписание пишется в Session этого потока.
        streamId: stream.id,
        title: data.title,
        date: data.date,
        startTime: data.startTime,
        status: data.status,
        meetingUrl: data.meetingUrl,
        notes: data.notes ?? undefined,
      });
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка обновления урока');
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    try {
      // Снимаем занятие с расписания потока (не удаляем урок-блок целиком).
      await unscheduleLesson(accessToken, id, stream.id);
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка снятия занятия');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <HintCallout
        storageKey="eduhint:stream-schedule-tab"
        title="Расписание = когда урок идёт этой группе"
      >
        Поставьте урок на дату — получится занятие (урок × эта группа × дата).
        Один урок можно проводить разным группам в разные дни.
      </HintCallout>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ScheduleCalendar
        editable
        lessons={lessons}
        lessonBasePath="/admin/lessons"
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onChanged={fetchAll}
        renderCreate={
          accessToken
            ? (defaultDate) => (
                <PlanEventDialog
                  accessToken={accessToken}
                  lockedMode="lesson"
                  streams={[stream]}
                  defaultStreamId={stream.id}
                  defaultDate={defaultDate}
                  onPlanned={fetchAll}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={stream.status !== 'active'}
                    >
                      <CalendarPlus />
                      Новое событие
                    </Button>
                  }
                />
              )
            : undefined
        }
      />
    </div>
  );
}

/** Дата "YYYY-MM-DD" в формате "ДД.ММ.ГГГГ" (без UTC-сдвига). */
function formatLessonDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString('ru-RU');
}

// Вкладка «Уроки» потока: read-only список уроков. Контент урока правится на
// странице урока /admin/lessons/[id]; здесь — только обзор и «снять с потока».
function LessonsTab({ stream }: { stream: StreamWithCounts }) {
  const { accessToken } = useAuth();
  const router = useRouter();

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Подтверждение снятия урока с потока + индикатор по конкретному уроку.
  const [lessonToUnschedule, setLessonToUnschedule] = useState<Lesson | null>(null);
  const [unschedulingId, setUnschedulingId] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      // getLessons(streamId) работает и для программных, и для менторских потоков.
      const { lessons } = await getLessons(accessToken, stream.id);
      setLessons([...lessons].sort((a, b) => a.sortOrder - b.sortOrder));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки уроков');
    } finally {
      setLoading(false);
    }
  }, [accessToken, stream.id]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  const handleUnschedule = async (lesson: Lesson) => {
    if (!accessToken) return;
    setUnschedulingId(lesson.id);
    setError('');
    try {
      // Снимаем урок с расписания потока (не удаляем урок-блок целиком).
      await unscheduleLesson(accessToken, lesson.id, stream.id);
      await fetchLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка снятия урока с группы');
    } finally {
      setUnschedulingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <HintCallout
        storageKey="eduhint:stream-lessons-tab"
        title="Уроки этой группы"
      >
        Это уроки из копилки, поставленные в расписание группы. «Запланировать
        занятие» добавляет урок в эту группу. «Снять с группы» убирает занятие из
        расписания — сам урок-блок и его контент остаются в копилке.
      </HintCallout>

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Уроки группы</h2>
        {/* Планируем урок прямо здесь с предвыбранной текущей группой. Для архивной
            группы кнопка диалога задизейблена (нет активных потоков для планирования). */}
        {accessToken && (
          <PlanEventDialog
            accessToken={accessToken}
            lockedMode="lesson"
            streams={[stream]}
            defaultStreamId={stream.id}
            onPlanned={fetchLessons}
            triggerClassName="w-full sm:w-auto"
            triggerDisabled={stream.status !== 'active'}
          />
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">#</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead className="w-[1%] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : lessons.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  В группе пока нет уроков. Нажмите «Запланировать занятие».
                </TableCell>
              </TableRow>
            ) : (
              lessons.map((lesson) => (
                <TableRow key={lesson.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {lesson.sortOrder}
                  </TableCell>
                  <TableCell>
                    {/* ?streamId — forward-compatible: будущий View Mode урока
                        покажет контекст этой группы; текущая страница его игнорирует. */}
                    <Link
                      href={`/admin/lessons/${lesson.id}?streamId=${stream.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {lesson.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {/* Бейдж статуса = контрол смены статуса (дропдаун + «Провести»).
                        «Запланирован» требует даты → предлагаем открыть урок (там дата). */}
                    <SessionStatusControl
                      lessonId={lesson.id}
                      streamId={stream.id}
                      status={lesson.status}
                      hasDate={!!lesson.date}
                      onChanged={fetchLessons}
                      onEditRequest={() =>
                        router.push(`/admin/lessons/${lesson.id}?streamId=${stream.id}`)
                      }
                    />
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {lesson.date
                      ? `${formatLessonDate(lesson.date)}${lesson.startTime ? ` · ${lesson.startTime}` : ''}`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" asChild>
                            <Link href={`/admin/lessons/${lesson.id}?streamId=${stream.id}`}>
                              <ExternalLink />
                              <span className="sr-only">Открыть урок</span>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Открыть урок (контент правится там)</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            disabled={unschedulingId === lesson.id}
                            onClick={() => setLessonToUnschedule(lesson)}
                          >
                            {unschedulingId === lesson.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <CalendarX />
                            )}
                            <span className="sr-only">Снять с группы</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Снять с группы</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!lessonToUnschedule}
        onOpenChange={(open) => { if (!open) setLessonToUnschedule(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять урок с группы?</AlertDialogTitle>
            <AlertDialogDescription>
              {lessonToUnschedule &&
                `Урок «${lessonToUnschedule.title}» будет снят с расписания этой группы. Сам урок-блок останется — его можно запланировать снова.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (lessonToUnschedule) handleUnschedule(lessonToUnschedule); }}
            >
              Снять с группы
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Вкладка «Задания» потока: плоский список заданий. Создание/выдача — со страницы
// урока; здесь — обзор, переход в проверку и снятие задания.
function AssignmentsTab({ streamId }: { streamId: string }) {
  const { accessToken } = useAuth();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Подтверждение снятия задания + индикатор по конкретному заданию.
  const [assignmentToDelete, setAssignmentToDelete] = useState<Assignment | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Индикатор выдачи по конкретному заданию (до-материализация назначений).
  const [issuingId, setIssuingId] = useState<string | null>(null);

  const fetchAssignments = useCallback(async () => {
    if (!accessToken || !streamId) return;
    setLoading(true);
    try {
      const { assignments } = await getAssignments(accessToken, streamId);
      setAssignments(assignments);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки заданий');
    } finally {
      setLoading(false);
    }
  }, [accessToken, streamId]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const handleDelete = async (assignment: Assignment) => {
    if (!accessToken) return;
    setDeletingId(assignment.id);
    setError('');
    try {
      await deleteAssignment(accessToken, assignment.id);
      await fetchAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка снятия задания');
    } finally {
      setDeletingId(null);
    }
  };

  // Выдать задание студентам потока: эндпоинт идемпотентен (skipDuplicates) —
  // материализует StudentAssignment всем зачисленным без дублей.
  const handleIssue = async (assignment: Assignment) => {
    if (!accessToken) return;
    setIssuingId(assignment.id);
    try {
      await createAssignment(accessToken, {
        streamId: assignment.streamId,
        lessonId: assignment.lessonId ?? undefined,
        title: assignment.title,
        description: assignment.description ?? undefined,
        criteria: assignment.criteria ?? undefined,
        type: assignment.type,
        tags: assignment.tags,
        materials: assignment.materials,
        dueDate: assignment.dueDate ?? undefined,
      });
      await fetchAssignments();
      toast.success('Задание выдано студентам');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось выдать задание');
    } finally {
      setIssuingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <HintCallout
        storageKey="eduhint:stream-assignments-tab"
        title="Задания приходят из уроков"
      >
        Задание (ДЗ) живёт внутри урока. Здесь — задания, выданные этой группе:
        студенты сдают, вы проверяете. Само ДЗ создаётся и редактируется на
        странице урока.
      </HintCallout>

      <h2 className="text-lg font-semibold tracking-tight">Задания группы</h2>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Дедлайн</TableHead>
              <TableHead className="w-[1%] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : assignments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="h-24 text-center text-muted-foreground"
                >
                  В группе пока нет заданий. Выдайте ДЗ со страницы урока.
                </TableCell>
              </TableRow>
            ) : (
              assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      href={`/admin/assignments/${a.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {a.title}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {a.dueDate
                      ? new Date(a.dueDate).toLocaleString('ru-RU', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {/* Назначений нет — проверять нечего: предлагаем выдать. */}
                      {a._count?.studentAssignments === 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={issuingId === a.id}
                          onClick={() => handleIssue(a)}
                        >
                          {issuingId === a.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Send />
                          )}
                          Выдать
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/admin/assignments/${a.id}`}>Проверить</Link>
                        </Button>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            disabled={deletingId === a.id}
                            onClick={() => setAssignmentToDelete(a)}
                          >
                            {deletingId === a.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Trash2 />
                            )}
                            <span className="sr-only">Снять задание</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Снять задание</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!assignmentToDelete}
        onOpenChange={(open) => { if (!open) setAssignmentToDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять задание?</AlertDialogTitle>
            <AlertDialogDescription>
              {assignmentToDelete &&
                `Задание «${assignmentToDelete.title}» и все его назначения будут удалены. Действие необратимо.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (assignmentToDelete) handleDelete(assignmentToDelete); }}
            >
              Снять задание
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Допустимые дни списания для менторских групп (бэк: 1..28).
const BILLING_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

// Маленький бейдж типа оплаты группы: «Ежемесячная» (secondary) / «Разовая» (outline).
function BillingTypeBadge({ billingType }: { billingType: StreamBillingType }) {
  return (
    <Badge variant={billingType === 'monthly' ? 'secondary' : 'outline'}>
      {BILLING_TYPE_LABELS[billingType]}
    </Badge>
  );
}

// Бейдж платёжного статуса студента по группе.
const PAYMENT_STATUS_META: Record<
  StreamChargePaymentStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  paid: { label: 'Оплачено', variant: 'default' },
  partial: { label: 'Частично', variant: 'secondary' },
  unpaid: { label: 'Должен', variant: 'destructive' },
  none: { label: 'Нет начислений', variant: 'outline' },
};

// Карточка платёжного плана группы: выбор типа оплаты (разовая/ежемесячная) + поля.
// Разовая: цена группы (priceKopecks). Ежемесячная (менторская): сумма в месяц
// (monthlyPriceKopecks) + день списания (billingDayOfMonth, 1..28). Суммы в рублях
// конвертируются в копейки. Правило бэка: для monthly сумма и день обязательны.
function PaymentPlanCard({
  stream,
  onChanged,
}: {
  stream: StreamWithCounts;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();

  const savedType: StreamBillingType = stream.billingType ?? 'one_time';
  const [type, setType] = useState<StreamBillingType>(savedType);
  // Разовая цена и месячная сумма ведём раздельно, чтобы переключение типа не
  // затирало введённое и показывало сохранённые значения каждого режима.
  const [onceValue, setOnceValue] = useState(kopecksToRublesInput(stream.priceKopecks));
  const [monthlyValue, setMonthlyValue] = useState(
    kopecksToRublesInput(stream.monthlyPriceKopecks),
  );
  const [day, setDay] = useState<string>(
    stream.billingDayOfMonth != null ? String(stream.billingDayOfMonth) : '',
  );
  // Ссылка на оплату (опционально). null с бэка показываем как пустую строку.
  const [paymentUrl, setPaymentUrl] = useState(stream.paymentUrl ?? '');
  const [saving, setSaving] = useState(false);

  // Синхронизируем поля, если план изменился извне (после рефетча группы).
  useEffect(() => {
    setType(stream.billingType ?? 'one_time');
    setOnceValue(kopecksToRublesInput(stream.priceKopecks));
    setMonthlyValue(kopecksToRublesInput(stream.monthlyPriceKopecks));
    setDay(stream.billingDayOfMonth != null ? String(stream.billingDayOfMonth) : '');
    setPaymentUrl(stream.paymentUrl ?? '');
  }, [stream.billingType, stream.priceKopecks, stream.monthlyPriceKopecks, stream.billingDayOfMonth, stream.paymentUrl]);

  // --- Разбор и валидация по выбранному типу ---
  const onceTrimmed = onceValue.trim();
  const onceParsed = onceTrimmed === '' ? null : rublesToKopecks(onceTrimmed);
  const onceInvalid = onceTrimmed !== '' && onceParsed === null;

  const monthlyTrimmed = monthlyValue.trim();
  const monthlyParsed = monthlyTrimmed === '' ? null : rublesToKopecks(monthlyTrimmed);
  const monthlyAmountInvalid = monthlyTrimmed !== '' && monthlyParsed === null;
  const dayNum = day === '' ? null : Number(day);
  // Для месячной: сумма (≥0) и день (1..28) обязательны.
  const monthlyAmountMissing = type === 'monthly' && monthlyParsed === null;
  const monthlyDayMissing = type === 'monthly' && dayNum === null;

  const invalid =
    type === 'one_time'
      ? onceInvalid
      : monthlyAmountInvalid || monthlyAmountMissing || monthlyDayMissing;

  // Ссылка на оплату: сравниваем обрезанное значение с сохранённым (null → '').
  const paymentUrlTrimmed = paymentUrl.trim();
  const paymentUrlDirty = paymentUrlTrimmed !== (stream.paymentUrl ?? '');

  // «Грязное» состояние: изменился тип, значимые поля выбранного типа или ссылка.
  const dirty =
    paymentUrlDirty ||
    type !== savedType ||
    (type === 'one_time'
      ? (onceParsed ?? null) !== (stream.priceKopecks ?? null)
      : (monthlyParsed ?? null) !== (stream.monthlyPriceKopecks ?? null) ||
        (dayNum ?? null) !== (stream.billingDayOfMonth ?? null));

  const handleSave = async () => {
    if (!accessToken || invalid) return;
    setSaving(true);
    try {
      // Ссылку шлём в обоих режимах: пустая строка = бэк очистит её в null.
      // URL валидирует бэк — при 400 покажем его сообщение тостом ниже.
      if (type === 'one_time') {
        // Разовая: пустая цена = снять план (priceKopecks: null).
        await updateStream(accessToken, stream.id, {
          billingType: 'one_time',
          priceKopecks: onceParsed,
          paymentUrl: paymentUrlTrimmed,
        });
        toast.success(onceParsed === null ? 'Платёжный план снят' : 'Цена группы сохранена');
      } else {
        await updateStream(accessToken, stream.id, {
          billingType: 'monthly',
          monthlyPriceKopecks: monthlyParsed,
          billingDayOfMonth: dayNum,
          paymentUrl: paymentUrlTrimmed,
        });
        toast.success('Ежемесячный план сохранён');
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения плана');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-base">Платёжный план</CardTitle>
        <BillingTypeBadge billingType={savedType} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Выбор типа оплаты */}
        <div className="flex flex-col gap-2">
          <Label>Тип оплаты</Label>
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <Button
              type="button"
              variant={type === 'one_time' ? 'default' : 'outline'}
              aria-pressed={type === 'one_time'}
              onClick={() => setType('one_time')}
            >
              Разовая
            </Button>
            <Button
              type="button"
              variant={type === 'monthly' ? 'default' : 'outline'}
              aria-pressed={type === 'monthly'}
              onClick={() => setType('monthly')}
            >
              Ежемесячная
            </Button>
          </div>
        </div>

        {type === 'one_time' ? (
          <div className="flex w-full flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="stream-price">Цена группы, ₽</Label>
            <Input
              id="stream-price"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={onceValue}
              onChange={(e) => setOnceValue(e.target.value)}
              placeholder="Например, 30000"
              aria-invalid={onceInvalid}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex w-full flex-col gap-2 sm:max-w-xs">
              <Label htmlFor="stream-monthly-price">Сумма в месяц, ₽</Label>
              <Input
                id="stream-monthly-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={monthlyValue}
                onChange={(e) => setMonthlyValue(e.target.value)}
                placeholder="Например, 10000"
                aria-invalid={monthlyAmountInvalid || monthlyAmountMissing}
              />
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-40">
              <Label htmlFor="stream-billing-day">День списания</Label>
              <Select value={day} onValueChange={setDay}>
                <SelectTrigger
                  id="stream-billing-day"
                  className="w-full"
                  aria-invalid={monthlyDayMissing}
                >
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_DAYS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Ссылка на оплату — внешняя платёжная страница группы (опционально). */}
        <div className="flex w-full flex-col gap-2">
          <Label htmlFor="stream-payment-url">Ссылка на оплату</Label>
          <Input
            id="stream-payment-url"
            type="url"
            inputMode="url"
            placeholder="https://..."
            value={paymentUrl}
            onChange={(e) => setPaymentUrl(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Платёжная страница группы — студенты увидят кнопку «Оплатить» в
            кабинете. Можно оставить пустым.
          </p>
        </div>

        <div>
          <Button
            onClick={handleSave}
            disabled={saving || invalid || !dirty}
            className="w-full sm:w-auto"
          >
            {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
            Сохранить
          </Button>
        </div>

        {/* Подсказки/валидация по выбранному типу */}
        {type === 'one_time' ? (
          onceInvalid ? (
            <p className="text-sm text-destructive">Укажите неотрицательную сумму в рублях.</p>
          ) : (stream.priceKopecks ?? null) === null ? (
            <p className="text-sm text-muted-foreground">
              План не задан — начисления по группе не делаются. Укажите цену, чтобы включить
              разовое начисление при зачислении студента.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Текущая цена:{' '}
              <span className="font-medium text-foreground">
                {formatKopecks(stream.priceKopecks ?? 0)}
              </span>
              . Очистите поле и сохраните, чтобы снять план.
            </p>
          )
        ) : monthlyAmountInvalid ? (
          <p className="text-sm text-destructive">Укажите неотрицательную сумму в рублях.</p>
        ) : monthlyAmountMissing || monthlyDayMissing ? (
          <p className="text-sm text-muted-foreground">
            Для ежемесячного плана укажите сумму и день списания (1–28).
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Списываем{' '}
            <span className="font-medium text-foreground">
              {formatKopecks(monthlyParsed ?? 0)}
            </span>{' '}
            с баланса каждый месяц, {dayNum}-го числа. Демо-аккаунты не списываются.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Таблица оплат группы: студент / начислено / оплачено / остаток / статус + возврат.
// На мобильных таблица превращается в стек карточек.
function StreamChargesSection({ stream }: { stream: StreamWithCounts }) {
  const { accessToken } = useAuth();

  const [priceKopecks, setPriceKopecks] = useState<number | null>(null);
  const [billingType, setBillingType] = useState<StreamBillingType>('one_time');
  const [monthlyPriceKopecks, setMonthlyPriceKopecks] = useState<number | null>(null);
  const [rows, setRows] = useState<StreamChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  // Возврат: выбранная строка + сумма (рубли) + индикатор.
  const [refundRow, setRefundRow] = useState<StreamChargeRow | null>(null);
  const [refundRubles, setRefundRubles] = useState('');
  const [refunding, setRefunding] = useState(false);

  const fetchCharges = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await getStreamCharges(accessToken, stream.id);
      setPriceKopecks(data.priceKopecks);
      setBillingType(data.billingType ?? 'one_time');
      setMonthlyPriceKopecks(data.monthlyPriceKopecks ?? null);
      setRows(data.students);
      setError('');
      setForbidden(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки оплат';
      if (message.toLowerCase().includes('доступ')) setForbidden(true);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, stream.id]);

  useEffect(() => {
    fetchCharges();
  }, [fetchCharges]);

  const openRefund = (row: StreamChargeRow) => {
    setRefundRow(row);
    // По умолчанию — вся оплаченная сумма (её и можно вернуть).
    setRefundRubles(kopecksToRublesInput(row.paidKopecks));
  };

  const handleRefund = async () => {
    if (!accessToken || !refundRow) return;
    const kopecks = rublesToKopecks(refundRubles);
    if (kopecks === null || kopecks <= 0) {
      toast.error('Укажите корректную сумму возврата');
      return;
    }
    if (kopecks > (refundRow.paidKopecks ?? 0)) {
      toast.error('Сумма возврата больше оплаченной');
      return;
    }
    setRefunding(true);
    try {
      await refundCharge(accessToken, refundRow.id, kopecks);
      toast.success(`Возвращено ${formatKopecks(kopecks)} на баланс студента`);
      setRefundRow(null);
      await fetchCharges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось выполнить возврат');
    } finally {
      setRefunding(false);
    }
  };

  // Остаток долга по строке — агрегат с бэка (Σ по open-начислениям, в т.ч. месячным).
  const outstanding = (row: StreamChargeRow) => Math.max(row.outstandingKopecks, 0);
  // Платёжный план настроен: для разовой — задана цена; для месячной — сумма.
  const planConfigured =
    billingType === 'monthly' ? monthlyPriceKopecks != null : priceKopecks !== null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-base">Оплаты</CardTitle>
        {!loading && !forbidden && <BillingTypeBadge billingType={billingType} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {forbidden ? (
          <p className="text-sm text-muted-foreground">
            Недостаточно прав для просмотра оплат группы.
          </p>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !planConfigured ? (
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {billingType === 'monthly'
                ? 'Ежемесячная сумма не задана. Укажите её в блоке «Платёжный план» выше — тогда пойдут ежемесячные списания.'
                : 'Цена группы не задана. Укажите её в блоке «Платёжный план» выше — тогда здесь появятся начисления и оплаты студентов.'}
            </span>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">В группе пока нет студентов.</p>
        ) : (
          <>
            {/* Десктоп: таблица */}
            <div className="hidden rounded-lg border sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Студент</TableHead>
                    <TableHead className="text-right">Начислено</TableHead>
                    <TableHead className="text-right">Оплачено</TableHead>
                    <TableHead className="text-right">Остаток</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="w-[1%] text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const meta = PAYMENT_STATUS_META[row.paymentStatus];
                    const due = outstanding(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          {/* row.id — это userId студента: имя ведёт на его карточку. */}
                          <Link
                            href={`/admin/students/${row.id}`}
                            className="flex flex-col rounded-md transition-colors hover:text-primary"
                          >
                            <span className="font-medium">{row.name}</span>
                            <span className="text-xs text-muted-foreground">{row.email}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.amountKopecks ? formatKopecks(row.amountKopecks) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatKopecks(row.paidKopecks ?? 0)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-medium ${
                            due > 0 ? 'text-destructive' : 'text-muted-foreground'
                          }`}
                        >
                          {due > 0 ? formatKopecks(due) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {(row.paidKopecks ?? 0) > 0 ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openRefund(row)}
                            >
                              <Undo2 aria-hidden="true" />
                              Вернуть
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Мобильные: карточки-стек */}
            <ul className="flex flex-col gap-3 sm:hidden">
              {rows.map((row) => {
                const meta = PAYMENT_STATUS_META[row.paymentStatus];
                const due = outstanding(row);
                return (
                  <li key={row.id} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/admin/students/${row.id}`}
                        className="flex min-w-0 flex-col rounded-md transition-colors hover:text-primary"
                      >
                        <span className="truncate font-medium">{row.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{row.email}</span>
                      </Link>
                      <Badge variant={meta.variant} className="shrink-0">
                        {meta.label}
                      </Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">Начислено</dt>
                        <dd className="tabular-nums">
                          {row.amountKopecks ? formatKopecks(row.amountKopecks) : '—'}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">Оплачено</dt>
                        <dd className="tabular-nums">{formatKopecks(row.paidKopecks ?? 0)}</dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">Остаток</dt>
                        <dd
                          className={`tabular-nums font-medium ${
                            due > 0 ? 'text-destructive' : 'text-muted-foreground'
                          }`}
                        >
                          {due > 0 ? formatKopecks(due) : '—'}
                        </dd>
                      </div>
                    </dl>
                    {(row.paidKopecks ?? 0) > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => openRefund(row)}
                      >
                        <Undo2 aria-hidden="true" />
                        Вернуть
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>

      {/* Диалог возврата с подтверждением суммы */}
      <Dialog open={!!refundRow} onOpenChange={(open) => { if (!open) setRefundRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Вернуть оплату</DialogTitle>
            <DialogDescription>
              {refundRow &&
                `Сумма вернётся на баланс студента «${refundRow.name}». Оплачено по группе: ${formatKopecks(refundRow.paidKopecks ?? 0)}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="refund-amount">Сумма возврата, ₽</Label>
            <Input
              id="refund-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={refundRubles}
              onChange={(e) => setRefundRubles(e.target.value)}
              placeholder="0"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundRow(null)} disabled={refunding}>
              Отмена
            </Button>
            <Button onClick={handleRefund} disabled={refunding}>
              {refunding && <Loader2 className="animate-spin" />}
              Вернуть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Сентинел «без ведущего» — Radix Select не допускает пустую строку как value.
const NO_OWNER = 'none';

function OverviewTab({
  stream,
  onOwnerChange,
  onGoToSchedule,
}: {
  stream: StreamWithCounts;
  onOwnerChange: () => void;
  onGoToSchedule: () => void;
}) {
  const { accessToken } = useAuth();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [savingOwner, setSavingOwner] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    getTeachers(accessToken)
      .then((data) => setTeachers(data.teachers))
      .catch(() => {});
  }, [accessToken]);

  // Назначить/сменить/снять ведущего потока.
  const handleOwnerChange = async (value: string) => {
    if (!accessToken) return;
    setSavingOwner(true);
    try {
      await updateStream(accessToken, stream.id, {
        ownerId: value === NO_OWNER ? null : value,
      });
      onOwnerChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка назначения ведущего');
    } finally {
      setSavingOwner(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ведущий</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select
            value={stream.ownerId ?? NO_OWNER}
            onValueChange={handleOwnerChange}
            disabled={savingOwner}
          >
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_OWNER}>Без ведущего</SelectItem>
              {teachers.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {savingOwner && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Преподаватели</CardTitle>
          {stream.shared && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="cursor-default">
                  Общий
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Группа считается общей, если по её урокам больше одного преподавателя.
              </TooltipContent>
            </Tooltip>
          )}
        </CardHeader>
        <CardContent>
          {stream.teachers && stream.teachers.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {stream.teachers.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <UserAvatar name={t.name} size="sm" />
                  <span className="text-sm">{t.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Преподаватели ещё не назначены на уроки группы.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Студентов
            </CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">
              {stream.studentsCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Уроков
            </CardTitle>
            <BookOpen className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">
              {stream.lessonsCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Платёжный план группы (цена) + таблица оплат студентов */}
      <PaymentPlanCard stream={stream} onChanged={onOwnerChange} />
      <StreamChargesSection stream={stream} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Быстрые действия</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {/* Расписание потока — это вкладка на этой же странице. */}
          <Button variant="outline" onClick={onGoToSchedule}>
            <CalendarDays />
            Расписание
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/assignments">
              <ClipboardList />
              Проверка заданий
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StudentsTab({
  streamId,
  streamName,
  onRosterChange,
}: {
  streamId: string;
  streamName: string;
  onRosterChange: () => void;
}) {
  const { accessToken } = useAuth();
  const router = useRouter();

  const [roster, setRoster] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Подтверждение удаления ученика из потока
  const [studentToRemove, setStudentToRemove] = useState<Student | null>(null);

  // Add-students dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);

  const fetchRoster = useCallback(async () => {
    if (!accessToken || !streamId) return;
    setLoading(true);
    try {
      const { students } = await getStreamStudents(accessToken, streamId);
      setRoster(students);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки студентов');
    } finally {
      setLoading(false);
    }
  }, [accessToken, streamId]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const openAddDialog = async () => {
    setSelected(new Set());
    setSearch('');
    setDialogOpen(true);
    if (!accessToken) return;
    setLoadingAll(true);
    try {
      const { users } = await getStudents(accessToken);
      setAllStudents(users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки списка');
    } finally {
      setLoadingAll(false);
    }
  };

  const rosterIds = new Set(roster.map((s) => s.id));
  const candidates = allStudents
    .filter((s) => s.role === 'student' && !rosterIds.has(s.id))
    .filter((s) => {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
      );
    });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEnroll = async () => {
    if (!accessToken || selected.size === 0) return;
    setEnrolling(true);
    setError('');
    try {
      await enrollStudents(accessToken, streamId, Array.from(selected));
      setDialogOpen(false);
      await fetchRoster();
      onRosterChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления');
    } finally {
      setEnrolling(false);
    }
  };

  const handleRemove = async (student: Student) => {
    if (!accessToken) return;
    setRemovingId(student.id);
    setError('');
    try {
      await unenrollStudent(accessToken, streamId, student.id);
      await fetchRoster();
      onRosterChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Студенты группы</h2>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {accessToken && (
            <InviteLinkDialog
              streamId={streamId}
              streamName={streamName}
              accessToken={accessToken}
            />
          )}
          <Button className="w-full shrink-0 sm:w-auto" onClick={openAddDialog}>
            <UserPlus />
            Добавить студентов
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[1%] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : roster.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-24 text-center text-muted-foreground"
                >
                  В группе пока нет студентов
                </TableCell>
              </TableRow>
            ) : (
              roster.map((student) => (
                // Вся строка ведёт на карточку студента (student.id — это userId).
                <TableRow
                  key={student.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/admin/students/${student.id}`)}
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {student.name}
                      {student.isDemo && <Badge variant="outline">Демо</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {student.email}
                  </TableCell>
                  <TableCell>
                    {student.isActive ? (
                      <Badge variant="secondary">Активен</Badge>
                    ) : (
                      <Badge variant="outline">Неактивен</Badge>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      disabled={removingId === student.id}
                      onClick={() => setStudentToRemove(student)}
                    >
                      {removingId === student.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Trash2 />
                      )}
                      <span className="sr-only">Убрать из группы</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить студентов</DialogTitle>
            <DialogDescription>
              Выберите студентов, которых нужно добавить в группу.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени или email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border">
            {loadingAll ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : candidates.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                Нет доступных студентов для добавления
              </div>
            ) : (
              <ul className="divide-y">
                {candidates.map((student) => (
                  <li key={student.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
                      <Checkbox
                        checked={selected.has(student.id)}
                        onCheckedChange={() => toggle(student.id)}
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="inline-flex items-center gap-2 truncate text-sm font-medium">
                          {student.name}
                          {student.isDemo && <Badge variant="outline">Демо</Badge>}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {student.email}
                        </span>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={enrolling}
            >
              Отмена
            </Button>
            <Button
              onClick={handleEnroll}
              disabled={enrolling || selected.size === 0}
            >
              {enrolling ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus />
              )}
              {enrolling
                ? 'Добавление...'
                : `Добавить${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!studentToRemove}
        onOpenChange={(open) => { if (!open) setStudentToRemove(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Убрать студента из группы?</AlertDialogTitle>
            <AlertDialogDescription>
              {studentToRemove && `Студент «${studentToRemove.name}» будет убран из этой группы.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (studentToRemove) handleRemove(studentToRemove); }}
            >
              Убрать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
