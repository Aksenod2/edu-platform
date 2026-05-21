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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Checkbox } from '@/components/ui/checkbox';
import { LessonsManager } from '@/components/lessons-manager';
import {
  getStream,
  getStreamStudents,
  enrollStudents,
  unenrollStudent,
  getStudents,
  type StreamWithCounts,
  type Student,
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
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="students">Ученики</TabsTrigger>
          <TabsTrigger value="lessons">Уроки</TabsTrigger>
          <TabsTrigger value="assignments">Задания</TabsTrigger>
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab stream={stream} />
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          <StudentsTab streamId={streamId} onRosterChange={fetchStream} />
        </TabsContent>

        <TabsContent value="lessons" className="mt-4">
          <LessonsManager streamId={streamId} />
        </TabsContent>

        <TabsContent value="assignments" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Задания потока</CardTitle>
              <CardDescription>
                Управление заданиями и проверка работ учеников.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/admin/streams/${streamId}/assignments`}>
                  <ClipboardList />
                  Открыть задания потока
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Расписание</CardTitle>
              <CardDescription>
                Запланированные занятия и встречи.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/admin/schedule">
                  <CalendarDays />
                  Открыть расписание
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ stream }: { stream: StreamWithCounts }) {
  return (
    <div className="flex flex-col gap-6">
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
            <Link href="/admin/schedule">
              <CalendarDays />
              Расписание
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
    if (!confirm(`Убрать ученика «${student.name}» из потока?`)) return;
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
                      onClick={() => handleRemove(student)}
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
    </div>
  );
}
