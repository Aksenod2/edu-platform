'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  MoreHorizontal,
  MessageSquare,
  Ban,
  Unlock,
  Mail,
  KeyRound,
  Trash2,
  Plus,
  User,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  inviteStudent,
  resetStudentPassword,
  getStreams,
  getStreamStudents,
  formatKopecks,
  type Student,
  type StreamWithCounts,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function StudentsPage() {
  const { accessToken } = useAuth();
  const router = useRouter();

  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  // Фильтр по потоку: '' — «Все потоки». Список студентов не содержит зачислений,
  // поэтому членство потока тянем отдельно (getStreamStudents) и фильтруем клиентом.
  const [streams, setStreams] = useState<StreamWithCounts[]>([]);
  const [streamFilter, setStreamFilter] = useState('');
  const [streamMemberIds, setStreamMemberIds] = useState<Set<string> | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Подтверждения деструктивных действий
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [studentToReset, setStudentToReset] = useState<Student | null>(null);

  const fetchStudents = useCallback(async () => {
    if (!accessToken) return;
    setLoadingStudents(true);
    try {
      const data = await getStudents(accessToken, search || undefined);
      setStudents(data.users);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingStudents(false);
    }
  }, [accessToken, search]);

  useEffect(() => {
    if (accessToken) fetchStudents();
  }, [accessToken, fetchStudents]);

  // Активные потоки для выпадающего фильтра.
  useEffect(() => {
    if (!accessToken) return;
    getStreams(accessToken)
      .then((data) => setStreams(data.streams.filter((s) => s.status === 'active')))
      .catch(() => {
        // Сбой загрузки потоков не должен ломать таблицу — фильтр просто останется пустым.
      });
  }, [accessToken]);

  // Членство выбранного потока: пересчитываем при смене фильтра.
  useEffect(() => {
    if (!accessToken || !streamFilter) {
      setStreamMemberIds(null);
      return;
    }
    let cancelled = false;
    setLoadingMembers(true);
    getStreamStudents(accessToken, streamFilter)
      .then((data) => {
        if (!cancelled) setStreamMemberIds(new Set(data.students.map((s) => s.id)));
      })
      .catch((err) => {
        if (!cancelled) {
          setStreamMemberIds(new Set()); // при ошибке поток считаем пустым, чтобы не показывать чужих
          setError(err instanceof Error ? err.message : 'Ошибка загрузки участников потока');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, streamFilter]);

  // Итоговый список: серверный поиск + клиентский фильтр по членству потока.
  const visibleStudents = streamFilter && streamMemberIds
    ? students.filter((s) => streamMemberIds.has(s.id))
    : students;
  const tableLoading = loadingStudents || (!!streamFilter && loadingMembers);

  const showMessage = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(''), 5000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setCreating(true);
    try {
      await createStudent(accessToken, newEmail, newName);
      setNewEmail('');
      setNewName('');
      setCreateOpen(false);
      showMessage('Ученик создан');
      await fetchStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (student: Student) => {
    if (!accessToken) return;
    try {
      await updateStudent(accessToken, student.id, { isActive: !student.isActive });
      showMessage(student.isActive ? 'Ученик заблокирован' : 'Ученик разблокирован');
      await fetchStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  const handleDelete = async (student: Student) => {
    if (!accessToken) return;
    try {
      await deleteStudent(accessToken, student.id);
      showMessage('Ученик удалён');
      await fetchStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  const handleInvite = async (student: Student) => {
    if (!accessToken) return;
    try {
      const data = await inviteStudent(accessToken, student.id);
      showMessage(`Invite-ссылка: ${data.inviteUrl}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка приглашения');
    }
  };

  const handleResetPassword = async (student: Student) => {
    if (!accessToken) return;
    try {
      const data = await resetStudentPassword(accessToken, student.id);
      showMessage(`Временный пароль: ${data.tempPassword}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сброса пароля');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Ученики</h1>
          <p className="text-sm text-muted-foreground">Управление учениками</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="w-full shrink-0 sm:w-auto">
              <Plus />
              Создать ученика
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый ученик</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-name">Имя</FieldLabel>
                  <Input
                    id="new-name"
                    placeholder="Имя"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-email">Email</FieldLabel>
                  <Input
                    id="new-email"
                    type="email"
                    placeholder="name@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <Button type="submit" disabled={creating} className="w-fit">
                    {creating ? 'Создание...' : 'Создать'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="break-all">{error}</AlertDescription>
        </Alert>
      )}

      {actionMessage && (
        <Alert>
          <AlertDescription className="break-all">{actionMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={streamFilter || 'all'}
          onValueChange={(v) => setStreamFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Все потоки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все потоки</SelectItem>
            {streams.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Баланс</TableHead>
              <TableHead>Создан</TableHead>
              <TableHead className="w-[1%] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-8 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : visibleStudents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {streamFilter
                    ? 'В этом потоке нет учеников'
                    : 'Ученики не найдены'}
                </TableCell>
              </TableRow>
            ) : (
              visibleStudents.map((s) => (
                <TableRow
                  key={s.id}
                  className={
                    s.deletedAt
                      ? 'opacity-50'
                      : 'cursor-pointer hover:bg-muted/50'
                  }
                  onClick={
                    s.deletedAt
                      ? undefined
                      : () => router.push(`/admin/students/${s.id}`)
                  }
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">{initials(s.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {!!s.submittedCount && s.submittedCount > 0 && (
                          <Badge variant="secondary">{s.submittedCount} ждут проверки</Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.email}</TableCell>
                  <TableCell>
                    {s.deletedAt ? (
                      <Badge variant="outline">Удалён</Badge>
                    ) : s.isActive ? (
                      <Badge>Активен</Badge>
                    ) : (
                      <Badge variant="destructive">Заблокирован</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatKopecks(s.balanceKopecks ?? 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(s.createdAt).toLocaleDateString('ru-RU')}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!s.deletedAt && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal />
                            <span className="sr-only">Действия</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>Действия</DropdownMenuLabel>
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/students/${s.id}`}>
                              <User />
                              Профиль
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/students/${s.id}/thread`}>
                              <MessageSquare />
                              Сообщения
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => handleToggleActive(s)}>
                            {s.isActive ? <Ban /> : <Unlock />}
                            {s.isActive ? 'Блокировать' : 'Разблокировать'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => handleInvite(s)}
                            disabled={!s.isActive}
                          >
                            <Mail />
                            Invite
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setStudentToReset(s)}>
                            <KeyRound />
                            Сброс пароля
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setStudentToDelete(s)}>
                            <Trash2 />
                            Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!studentToDelete}
        onOpenChange={(open) => { if (!open) setStudentToDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить ученика?</AlertDialogTitle>
            <AlertDialogDescription>
              {studentToDelete && `Ученик ${studentToDelete.name} будет удалён.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (studentToDelete) handleDelete(studentToDelete); }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!studentToReset}
        onOpenChange={(open) => { if (!open) setStudentToReset(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сбросить пароль?</AlertDialogTitle>
            <AlertDialogDescription>
              {studentToReset && `Для ученика ${studentToReset.name} будет сгенерирован новый временный пароль.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (studentToReset) handleResetPassword(studentToReset); }}
            >
              Сбросить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
