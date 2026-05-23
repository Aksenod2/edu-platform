'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  ArrowLeft,
  Loader2,
  Users,
  BookOpen,
  ClipboardList,
  CalendarDays,
  Plus,
  Trash2,
  Search,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { LessonsManager } from '@/components/lessons-manager';
import { StreamAssignmentsManager } from '@/components/stream-assignments-manager';
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
  getTeachers,
  updateStream,
  type StreamWithCounts,
  type Student,
  type Teacher,
} from '@/lib/api';

export default function StreamDetailPage() {
  const params = useParams();
  const streamId = params.streamId as string;
  const { user, accessToken } = useAuth();

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
      setError(err instanceof Error ? err.message : 'Ошибка загрузки потока');
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
        <Button
          variant="ghost"
          size="sm"
          className="w-fit -ml-2"
          asChild
        >
          <Link href="/admin/streams">
            <ArrowLeft />
            Назад
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || 'Поток не найден'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="w-fit -ml-2" asChild>
          <Link href="/admin/streams">
            <ArrowLeft />
            Назад
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{stream.name}</h1>
          {stream.status === 'active' ? (
            <Badge>Активный</Badge>
          ) : (
            <Badge variant="outline">Архивный</Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
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
          <OverviewTab stream={stream} onOwnerChange={fetchStream} />
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          <StudentsTab streamId={streamId} onRosterChange={fetchStream} />
        </TabsContent>

        <TabsContent value="lessons" className="mt-4">
          <LessonsManager streamId={streamId} />
        </TabsContent>

        <TabsContent value="assignments" className="mt-4">
          <StreamAssignmentsManager streamId={streamId} />
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
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ScheduleCalendar
        editable
        lessons={lessons}
        streams={[stream]}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
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
}: {
  stream: StreamWithCounts;
  onOwnerChange: () => void;
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
                Поток считается общим, если по его урокам больше одного преподавателя.
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
              Преподаватели ещё не назначены на уроки потока.
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
          <Button variant="outline" asChild>
            <Link href={`/admin/streams/${stream.id}/lessons`}>
              <BookOpen />
              Уроки
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/admin/streams/${stream.id}/assignments`}>
              <ClipboardList />
              Задания
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/lessons">
              <CalendarDays />
              Календарь
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
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Ученики потока</h2>
        <Button onClick={openAddDialog}>
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
                  В потоке пока нет учеников
                </TableCell>
              </TableRow>
            ) : (
              roster.map((student) => (
                <TableRow key={student.id}>
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
                  <TableCell className="text-right">
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
                      <span className="sr-only">Убрать из потока</span>
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
              Выберите учеников, которых нужно добавить в поток.
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
            <AlertDialogTitle>Убрать ученика из потока?</AlertDialogTitle>
            <AlertDialogDescription>
              {studentToRemove && `Ученик «${studentToRemove.name}» будет убран из этого потока.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
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
