'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  createStream,
  updateStream,
  archiveStream,
  deleteStream,
  getTeachers,
  rublesToKopecks,
  type Stream,
  type StreamWithCounts,
  type Teacher,
  type StreamBillingType,
} from '@/lib/api';
import {
  Loader2,
  Plus,
  Search,
  MoreHorizontal,
  BookOpen,
  ClipboardList,
  SquarePen,
  Archive,
  Trash2,
  UserCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { HintCallout } from '@/components/hint-callout';

// Допустимые дни списания для менторских групп (бэк: 1..28).
const BILLING_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

// Инициалы из имени для аватара преподавателя
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export default function StreamsPage() {
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const [streams, setStreams] = useState<StreamWithCounts[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [search, setSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [error, setError] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // Платёжный план новой группы (опционально). Разовая — цена; ежемесячная —
  // сумма в месяц + день списания (1..28).
  const [newBillingType, setNewBillingType] = useState<StreamBillingType>('one_time');
  const [newPrice, setNewPrice] = useState('');
  const [newMonthlyPrice, setNewMonthlyPrice] = useState('');
  const [newBillingDay, setNewBillingDay] = useState('');
  // Ссылка на оплату (опционально). Пустую отправляем как '' — бэк очистит в null.
  const [newPaymentUrl, setNewPaymentUrl] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  // Подтверждение архивирования потока
  const [streamToArchive, setStreamToArchive] = useState<Stream | null>(null);
  // Подтверждение полного удаления потока (необратимо)
  const [streamToDelete, setStreamToDelete] = useState<Stream | null>(null);

  const fetchStreams = useCallback(async () => {
    if (!accessToken) return;
    setLoadingStreams(true);
    try {
      const data = await getStreams(accessToken, { mine: mineOnly });
      setStreams(data.streams);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки групп');
    } finally {
      setLoadingStreams(false);
    }
  }, [accessToken, mineOnly]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchStreams();
    }
  }, [accessToken, user, fetchStreams]);

  // Список администраторов для пикера ведущего (грузим один раз).
  useEffect(() => {
    if (!accessToken || user?.role !== 'admin') return;
    getTeachers(accessToken)
      .then((data) => setTeachers(data.teachers))
      .catch(() => {});
  }, [accessToken, user]);

  // Собирает billing-опции новой группы с клиентской валидацией.
  // Возвращает undefined для «без явного плана» (разовая, цена не указана) и
  // null, если ввод невалиден (создание прерываем с тостом).
  const buildNewBilling = ():
    | Parameters<typeof createStream>[2]
    | undefined
    | null => {
    if (newBillingType === 'monthly') {
      const monthly = rublesToKopecks(newMonthlyPrice);
      const day = newBillingDay === '' ? null : Number(newBillingDay);
      if (monthly === null) {
        toast.error('Укажите ежемесячную сумму (неотрицательное число)');
        return null;
      }
      if (day === null || !Number.isInteger(day) || day < 1 || day > 28) {
        toast.error('Выберите день списания (1–28)');
        return null;
      }
      return { billingType: 'monthly', monthlyPriceKopecks: monthly, billingDayOfMonth: day };
    }
    // Разовая: цена опциональна. Пусто — план не задаём.
    if (newPrice.trim() === '') return undefined;
    const price = rublesToKopecks(newPrice);
    if (price === null) {
      toast.error('Укажите цену группы (неотрицательное число)');
      return null;
    }
    return { billingType: 'one_time', priceKopecks: price };
  };

  const resetCreateForm = () => {
    setNewName('');
    setNewBillingType('one_time');
    setNewPrice('');
    setNewMonthlyPrice('');
    setNewBillingDay('');
    setNewPaymentUrl('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !newName.trim()) return;
    const billing = buildNewBilling();
    if (billing === null) return; // невалидный план — не создаём
    // Ссылка на оплату едет в том же billing-объекте createStream. Пустую строку
    // шлём как есть — бэк очистит её в null. URL валидирует бэк (на 400 покажем ошибку).
    const paymentUrl = newPaymentUrl.trim();
    const payload = { ...(billing ?? {}), paymentUrl };
    setCreating(true);
    setError('');
    try {
      await createStream(accessToken, newName.trim(), payload);
      resetCreateForm();
      setShowCreateForm(false);
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания группы');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!accessToken || !editName.trim()) return;
    setSaving(true);
    setError('');
    try {
      await updateStream(accessToken, id, { name: editName.trim() });
      setEditingId(null);
      setEditName('');
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления группы');
    } finally {
      setSaving(false);
    }
  };

  // Назначить/сменить/снять ведущего потока. ownerId === null снимает ведущего.
  const handleSetOwner = async (id: string, ownerId: string | null) => {
    if (!accessToken) return;
    setError('');
    try {
      await updateStream(accessToken, id, { ownerId });
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка назначения ведущего');
    }
  };

  const handleArchive = async (id: string) => {
    if (!accessToken) return;
    setError('');
    try {
      await archiveStream(accessToken, id);
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка архивирования группы');
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    setError('');
    try {
      await deleteStream(accessToken, id);
      setStreamToDelete(null);
      await fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления группы');
    }
  };

  const filteredStreams = streams.filter((stream) =>
    stream.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Группы</h1>
          <p className="text-sm text-muted-foreground">Учебные группы и их уроки</p>
        </div>
        <Button
          variant={showCreateForm ? 'outline' : 'default'}
          className="w-full shrink-0 sm:w-auto"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? (
            'Отмена'
          ) : (
            <>
              <Plus />
              Создать группу
            </>
          )}
        </Button>
      </div>

      <HintCallout storageKey="eduhint:streams-list" title="Группа — это учебная группа студентов">
        Группа — это набор студентов. В неё зачисляют студентов и составляют
        расписание из уроков копилки. Один и тот же урок может идти в нескольких
        группах.
      </HintCallout>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="break-all">{error}</AlertDescription>
        </Alert>
      )}

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Новая группа</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-stream-name">Название группы</FieldLabel>
                  <Input
                    id="new-stream-name"
                    placeholder="Например: Группа #1"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                    required
                  />
                </Field>

                {/* Тип оплаты (опционально настраивается сразу при создании) */}
                <Field>
                  <FieldLabel>Тип оплаты</FieldLabel>
                  <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                    <Button
                      type="button"
                      variant={newBillingType === 'one_time' ? 'default' : 'outline'}
                      aria-pressed={newBillingType === 'one_time'}
                      onClick={() => setNewBillingType('one_time')}
                    >
                      Разовая
                    </Button>
                    <Button
                      type="button"
                      variant={newBillingType === 'monthly' ? 'default' : 'outline'}
                      aria-pressed={newBillingType === 'monthly'}
                      onClick={() => setNewBillingType('monthly')}
                    >
                      Ежемесячная
                    </Button>
                  </div>
                </Field>

                {newBillingType === 'one_time' ? (
                  <Field>
                    <FieldLabel htmlFor="new-stream-price">Цена группы, ₽</FieldLabel>
                    <Input
                      id="new-stream-price"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="Необязательно, например 30000"
                      className="sm:max-w-xs"
                    />
                  </Field>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Field className="sm:max-w-xs">
                      <FieldLabel htmlFor="new-stream-monthly">Сумма в месяц, ₽</FieldLabel>
                      <Input
                        id="new-stream-monthly"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        value={newMonthlyPrice}
                        onChange={(e) => setNewMonthlyPrice(e.target.value)}
                        placeholder="Например, 10000"
                      />
                    </Field>
                    <Field className="sm:w-40">
                      <FieldLabel htmlFor="new-stream-day">День списания</FieldLabel>
                      <Select value={newBillingDay} onValueChange={setNewBillingDay}>
                        <SelectTrigger id="new-stream-day" className="w-full">
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
                    </Field>
                  </div>
                )}

                <Field>
                  <FieldLabel htmlFor="new-stream-payment-url">
                    Ссылка на оплату
                  </FieldLabel>
                  <Input
                    id="new-stream-payment-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://..."
                    value={newPaymentUrl}
                    onChange={(e) => setNewPaymentUrl(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Платёжная страница группы — студенты увидят кнопку «Оплатить» в
                    кабинете. Можно оставить пустым.
                  </p>
                </Field>

                <Field>
                  <Button
                    type="submit"
                    disabled={creating || !newName.trim()}
                    className="w-fit"
                  >
                    {creating && <Loader2 className="animate-spin" />}
                    {creating ? 'Создание...' : 'Создать'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm whitespace-nowrap">
          <Checkbox
            checked={mineOnly}
            onCheckedChange={(v) => setMineOnly(v === true)}
          />
          Только мои группы
        </label>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Ведущий</TableHead>
              <TableHead>Преподаватели</TableHead>
              <TableHead className="text-right">Студентов</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Создан</TableHead>
              <TableHead className="w-[1%] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingStreams ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : filteredStreams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  Группы не найдены
                </TableCell>
              </TableRow>
            ) : (
              filteredStreams.map((stream) => (
                <TableRow
                  key={stream.id}
                  className={
                    editingId === stream.id
                      ? stream.status === 'archived'
                        ? 'opacity-50'
                        : undefined
                      : `cursor-pointer hover:bg-muted/50${
                          stream.status === 'archived' ? ' opacity-50' : ''
                        }`
                  }
                  onClick={
                    editingId === stream.id
                      ? undefined
                      : () => router.push(`/admin/streams/${stream.id}`)
                  }
                >
                  <TableCell>
                    {editingId === stream.id ? (
                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="max-w-[250px]"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleUpdate(stream.id)}
                          disabled={saving || !editName.trim()}
                        >
                          {saving && <Loader2 className="animate-spin" />}
                          Сохранить
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingId(null);
                            setEditName('');
                          }}
                        >
                          Отмена
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium">{stream.name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {stream.owner ? (
                      <span>{stream.owner.name}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {stream.teachers && stream.teachers.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {stream.teachers.map((t) => (
                            <Avatar
                              key={t.id}
                              size="sm"
                              className="ring-2 ring-background"
                              title={t.name}
                            >
                              <AvatarFallback>{initials(t.name)}</AvatarFallback>
                            </Avatar>
                          ))}
                        </div>
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
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stream.studentsCount}
                  </TableCell>
                  <TableCell>
                    {stream.status === 'active' ? (
                      <Badge>Активный</Badge>
                    ) : (
                      <Badge variant="outline">Архивный</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(stream.createdAt).toLocaleDateString('ru-RU')}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {editingId !== stream.id && (
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
                            <Link href={`/admin/streams/${stream.id}?tab=lessons`}>
                              <BookOpen />
                              Уроки
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/streams/${stream.id}?tab=assignments`}>
                              <ClipboardList />
                              Задания
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditingId(stream.id);
                              setEditName(stream.name);
                            }}
                          >
                            <SquarePen />
                            Редактировать
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <UserCog />
                              Ведущий
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuRadioGroup
                                value={stream.ownerId ?? ''}
                                onValueChange={(value) =>
                                  handleSetOwner(stream.id, value || null)
                                }
                              >
                                <DropdownMenuRadioItem value="">
                                  Без ведущего
                                </DropdownMenuRadioItem>
                                {teachers.map((t) => (
                                  <DropdownMenuRadioItem key={t.id} value={t.id}>
                                    {t.name}
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          {stream.status === 'active' && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setStreamToArchive(stream)}
                            >
                              <Archive />
                              Архивировать
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {/* Удаление доступно для любого потока (активного и архивного). */}
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setStreamToDelete(stream)}
                          >
                            <Trash2 />
                            Удалить группу
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
        open={!!streamToArchive}
        onOpenChange={(open) => { if (!open) setStreamToArchive(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Архивировать группу?</AlertDialogTitle>
            <AlertDialogDescription>
              {streamToArchive && `Группа «${streamToArchive.name}» будет перемещена в архив.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (streamToArchive) handleArchive(streamToArchive.id); }}
            >
              Архивировать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!streamToDelete}
        onOpenChange={(open) => { if (!open) setStreamToDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить группу?</AlertDialogTitle>
            <AlertDialogDescription>
              {streamToDelete && (
                <>
                  Группа «{streamToDelete.name}» будет удалена безвозвратно. Действие
                  необратимо: будут удалены зачисления студентов, расписание занятий
                  и чаты группы. Контент уроков сохранится.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                // Удаление асинхронно: не закрываем диалог автоматически, чтобы при
                // ошибке он не схлопнулся раньше времени — закрытие делает handleDelete.
                e.preventDefault();
                if (streamToDelete) handleDelete(streamToDelete.id);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
