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
  Plus,
  Trash2,
  Search,
  UserPlus,
  ExternalLink,
  CalendarX,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/back-button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  type CalendarCreateData,
  type CalendarUpdateData,
} from '@/components/schedule-calendar';
import {
  getStream,
  getStreamStudents,
  enrollStudents,
  unenrollStudent,
  getStudents,
  getLessons,
  createLesson,
  updateLesson,
  unscheduleLesson,
  getAssignments,
  createAssignment,
  deleteAssignment,
  getTeachers,
  updateStream,
  LESSON_STATUS_LABELS,
  type StreamWithCounts,
  type Student,
  type Teacher,
  type Lesson,
  type LessonStatus,
  type Assignment,
} from '@/lib/api';
import { HintCallout } from '@/components/hint-callout';

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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{stream.name}</h1>
          {stream.status === 'active' ? (
            <Badge>Активный</Badge>
          ) : (
            <Badge variant="outline">Архивный</Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="-m-1.5 overflow-x-auto p-1.5">
          <TabsList>
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="students">Ученики</TabsTrigger>
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
          <StudentsTab streamId={streamId} onRosterChange={fetchStream} />
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

  const handleCreate = async (data: CalendarCreateData) => {
    if (!accessToken) return;
    try {
      await createLesson(accessToken, {
        streamId: stream.id,
        title: data.title,
        date: data.date || null,
        startTime: data.startTime,
        status: data.status,
        meetingUrl: data.meetingUrl,
        notes: data.notes ?? undefined,
      });
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка создания урока');
    }
  };

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
        streams={[stream]}
        lessonBasePath="/admin/lessons"
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}

// Вариант бейджа для статуса урока (совпадает с другими экранами уроков).
const lessonStatusBadgeVariant: Record<
  LessonStatus,
  'secondary' | 'default' | 'outline' | 'destructive'
> = {
  draft: 'secondary',
  planned: 'default',
  done: 'outline',
  cancelled: 'destructive',
};

/** Дата "YYYY-MM-DD" в формате "ДД.ММ.ГГГГ" (без UTC-сдвига). */
function formatLessonDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString('ru-RU');
}

// Вкладка «Уроки» потока: read-only список уроков. Контент урока правится на
// странице урока /admin/lessons/[id]; здесь — только обзор и «снять с потока».
function LessonsTab({ stream }: { stream: StreamWithCounts }) {
  const { accessToken } = useAuth();

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
        Это уроки из копилки, поставленные в расписание группы. «Снять с группы»
        убирает занятие из расписания — сам урок-блок и его контент остаются в
        копилке.
      </HintCallout>

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Уроки группы</h2>
        <Button asChild>
          <Link href="/admin/schedule">
            <CalendarDays />
            Запланировать занятие
          </Link>
        </Button>
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
                  В группе пока нет уроков. Запланируйте занятие в расписании.
                </TableCell>
              </TableRow>
            ) : (
              lessons.map((lesson) => (
                <TableRow key={lesson.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {lesson.sortOrder}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/lessons/${lesson.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {lesson.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={lessonStatusBadgeVariant[lesson.status] ?? 'default'}>
                      {LESSON_STATUS_LABELS[lesson.status]}
                    </Badge>
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
                            <Link href={`/admin/lessons/${lesson.id}`}>
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
        ученики сдают, вы проверяете. Само ДЗ создаётся и редактируется на
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

// Инициалы из имени для аватара преподавателя
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
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
            <SelectTrigger className="w-[260px]">
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
                  <Avatar size="sm">
                    <AvatarFallback>{initials(t.name)}</AvatarFallback>
                  </Avatar>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Учеников
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
  onRosterChange,
}: {
  streamId: string;
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
      setError(err instanceof Error ? err.message : 'Ошибка загрузки учеников');
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
        <h2 className="text-lg font-semibold tracking-tight">Ученики группы</h2>
        <Button className="w-full shrink-0 sm:w-auto" onClick={openAddDialog}>
          <UserPlus />
          Добавить учеников
        </Button>
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
                  В группе пока нет учеников
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
                  <TableCell className="font-medium">{student.name}</TableCell>
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
            <DialogTitle>Добавить учеников</DialogTitle>
            <DialogDescription>
              Выберите учеников, которых нужно добавить в группу.
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
                Нет доступных учеников для добавления
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
                        <span className="truncate text-sm font-medium">
                          {student.name}
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
            <AlertDialogTitle>Убрать ученика из группы?</AlertDialogTitle>
            <AlertDialogDescription>
              {studentToRemove && `Ученик «${studentToRemove.name}» будет убран из этой группы.`}
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
