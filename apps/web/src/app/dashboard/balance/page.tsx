'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Loader2,
  Wallet,
  ExternalLink,
  Upload,
  X,
  TriangleAlert,
  CheckCircle2,
  CalendarClock,
  Info,
  ChevronsUpDown,
  Inbox,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  getWallet,
  getMyTopUpRequests,
  createTopUpRequest,
  formatKopecks,
  TOPUP_STATUS_LABELS,
  type WalletTransaction,
  type TopUpRequest,
  type TopUpRequestStatus,
  type StudentCharge,
  type ChargeStatus,
  type NextMentorshipCharge,
  type PayableStream,
} from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Бейдж статуса заявки: одобрена — нейтральный, отклонена — destructive, ожидание — outline.
const STATUS_VARIANT: Record<
  TopUpRequestStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  pending: 'outline',
  approved: 'default',
  rejected: 'destructive',
};

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Общий текст-дисклеймер: без скриншота чека оплата не засчитывается. Требование
// заказчика — показываем его и под кнопками «Оплатить», и в шапке формы «Я оплатил».
const SCREENSHOT_DISCLAIMER =
  'После оплаты обязательно приложите скриншот чека в разделе «Я оплатил» — иначе оплата не будет зачтена за вами.';

// Дата ISO → «5 июня 2026» (день числом + месяц словами), для строки «Ближайшее списание».
// День списания на бэке задаётся по московскому времени, поэтому и форматируем в
// Europe/Moscow — иначе в браузере западнее МСК дата уезжала бы на сутки назад.
function formatChargeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
}

// Бейдж статуса начисления по группе.
const CHARGE_STATUS_META: Record<
  ChargeStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  open: { label: 'Не оплачено', variant: 'outline' },
  paid: { label: 'Оплачено', variant: 'default' },
  refunded: { label: 'Возврат', variant: 'secondary' },
};

export default function StudentBalancePage() {
  const { user, accessToken } = useAuth();

  const [balanceKopecks, setBalanceKopecks] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [charges, setCharges] = useState<StudentCharge[]>([]);
  const [outstandingKopecks, setOutstandingKopecks] = useState(0);
  const [nextCharges, setNextCharges] = useState<NextMentorshipCharge[]>([]);
  // Активные группы студента с внешней ссылкой на оплату (кнопка «Оплатить»).
  const [payableStreams, setPayableStreams] = useState<PayableStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState('');

  // Форма «Я оплатил».
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [amountRubles, setAmountRubles] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Управляемое раскрытие Collapsible формы «Я оплатил». null = ещё не инициализировали
  // из данных (ждём загрузку), чтобы авто-раскрытие отработало один раз после fetch.
  const [payFormOpen, setPayFormOpen] = useState<boolean | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!accessToken || !user) return;
    setLoading(true);
    try {
      const data = await getWallet(accessToken, user.id);
      setBalanceKopecks(data.balanceKopecks);
      setTransactions(data.transactions);
      // charges/outstandingKopecks/nextMentorshipCharges могут отсутствовать у старого
      // бэка — страхуемся значениями по умолчанию.
      setCharges(data.charges ?? []);
      setOutstandingKopecks(data.outstandingKopecks ?? 0);
      setNextCharges(data.nextMentorshipCharges ?? []);
      setPayableStreams(data.payableStreams ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки баланса');
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  const fetchRequests = useCallback(async () => {
    if (!accessToken) return;
    setRequestsLoading(true);
    try {
      const data = await getMyTopUpRequests(accessToken);
      setRequests(data.requests);
      setRequestsError('');
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : 'Ошибка загрузки заявок');
    } finally {
      setRequestsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchWallet();
    fetchRequests();
  }, [fetchWallet, fetchRequests]);

  // Локальное превью выбранного скрина; отзываем objectURL при смене файла.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const hasPending = requests.some((r) => r.status === 'pending');
  const hasDebt = outstandingKopecks > 0;

  // Авто-раскрытие формы «Я оплатил»: один раз, когда баланс уже загружен и
  // мы ещё не трогали состояние вручную. Раскрываем при долге и отсутствии pending-заявки.
  useEffect(() => {
    if (payFormOpen !== null) return;
    if (balanceKopecks === null || requestsLoading) return;
    setPayFormOpen(hasDebt && !hasPending);
  }, [payFormOpen, balanceKopecks, requestsLoading, hasDebt, hasPending]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(selected.type)) {
      toast.error('Поддерживаются только изображения PNG, JPEG или WebP');
      e.target.value = '';
      return;
    }
    setFile(selected);
  }

  function clearFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!file) {
      toast.error('Прикрепите скриншот оплаты');
      return;
    }

    // Сумма опциональна; если указана — переводим рубли в копейки целым числом.
    let claimedAmountKopecks: number | undefined;
    if (amountRubles.trim()) {
      const rubles = Number(amountRubles.replace(',', '.'));
      if (!Number.isFinite(rubles) || rubles <= 0) {
        toast.error('Укажите корректную сумму перевода');
        return;
      }
      claimedAmountKopecks = Math.round(rubles * 100);
    }

    setSubmitting(true);
    try {
      await createTopUpRequest(accessToken, {
        file,
        claimedAmountKopecks,
        note: note.trim() || undefined,
      });
      toast.success('Заявка отправлена. Преподаватель проверит оплату и зачислит средства.');
      clearFile();
      setAmountRubles('');
      setNote('');
      fetchRequests();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось отправить заявку';
      // Анти-спам: сервер отвечает 409, если уже есть заявка на рассмотрении.
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  // ——— Тело формы «Я оплатил» (используется внутри Collapsible). ———
  const payForm = (
    <div className="flex flex-col gap-4">
      {/* Дисклеймер про обязательный скриншот — повтор в шапке формы. */}
      <Alert>
        <Info />
        <AlertDescription>{SCREENSHOT_DISCLAIMER}</AlertDescription>
      </Alert>

      {hasPending && (
        <Alert>
          <AlertDescription>
            У вас уже есть заявка на рассмотрении. Дождитесь её обработки, прежде чем
            отправлять новую.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="screenshot">
            Скриншот оплаты <span className="text-destructive">*</span>
          </Label>
          {previewUrl ? (
            <div className="relative w-fit">
              {/* img, а не next/image: src — локальный objectURL превью */}
              <img
                src={previewUrl}
                alt="Превью скриншота"
                className="max-h-48 rounded-lg border object-contain"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-2 top-2 size-7"
                onClick={clearFile}
                aria-label="Убрать скриншот"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full justify-start"
            >
              <Upload />
              Выбрать изображение
            </Button>
          )}
          <input
            ref={fileInputRef}
            id="screenshot"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
          <p className="text-xs text-muted-foreground">PNG, JPEG или WebP</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="amount">Сумма перевода, ₽</Label>
          <Input
            id="amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amountRubles}
            onChange={(e) => setAmountRubles(e.target.value)}
            placeholder="Например, 5000"
          />
          <p className="text-xs text-muted-foreground">
            Необязательно. Помогает преподавателю быстрее сверить оплату.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="note">Комментарий</Label>
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Необязательно"
            rows={2}
          />
        </div>

        <Button type="submit" disabled={submitting || !file || hasPending}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitting ? 'Отправка...' : 'Отправить заявку'}
        </Button>
      </form>
    </div>
  );

  // ——— Таблица «Операции» (transactions). ———
  const transactionsView = error ? (
    <p className="text-sm text-destructive">Не удалось загрузить историю операций.</p>
  ) : transactions.length === 0 ? (
    <EmptyState icon={Wallet} title="Операций пока нет" />
  ) : (
    <>
      {/* Десктоп: таблица. Внешнюю границу даёт Card — своя рамка не нужна. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Операция</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
              <TableHead>Комментарий</TableHead>
              <TableHead>Дата</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => {
              const isTopup = tx.kind === 'topup';
              return (
                <TableRow key={tx.id}>
                  <TableCell>
                    <Badge variant={isTopup ? 'default' : 'secondary'}>
                      {isTopup ? 'Пополнение' : 'Списание'}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      isTopup ? 'text-foreground' : 'text-destructive'
                    }`}
                  >
                    {isTopup ? '+' : '−'}
                    {formatKopecks(tx.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-pre-wrap">
                    {tx.note || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(tx.createdAt).toLocaleString('ru-RU')}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Мобильные: ряды списка через divide-y, без рамок у каждого ряда. */}
      <ul className="divide-y sm:hidden">
        {transactions.map((tx) => {
          const isTopup = tx.kind === 'topup';
          return (
            <li key={tx.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={isTopup ? 'default' : 'secondary'}>
                  {isTopup ? 'Пополнение' : 'Списание'}
                </Badge>
                <span
                  className={`tabular-nums font-medium ${
                    isTopup ? 'text-foreground' : 'text-destructive'
                  }`}
                >
                  {isTopup ? '+' : '−'}
                  {formatKopecks(tx.amount)}
                </span>
              </div>
              {tx.note && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {tx.note}
                </p>
              )}
              <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                {new Date(tx.createdAt).toLocaleString('ru-RU')}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );

  // ——— Таблица «По группам» (charges). ———
  const chargesView = error ? (
    <p className="text-sm text-destructive">Не удалось загрузить начисления.</p>
  ) : charges.length === 0 ? (
    <EmptyState icon={Wallet} title="Начислений пока нет" />
  ) : (
    <>
      {/* Десктоп: таблица. Внешнюю границу даёт Card — своя рамка не нужна. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Группа</TableHead>
              <TableHead className="text-right">Начислено</TableHead>
              <TableHead className="text-right">Оплачено</TableHead>
              <TableHead className="text-right">Остаток</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charges.map((c) => {
              const meta = CHARGE_STATUS_META[c.status];
              const due = Math.max(c.amountKopecks - c.paidKopecks, 0);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-foreground">
                    {c.streamName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKopecks(c.amountKopecks)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKopecks(c.paidKopecks)}
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Мобильные: ряды списка через divide-y, без рамок у каждого ряда. */}
      <ul className="divide-y sm:hidden">
        {charges.map((c) => {
          const meta = CHARGE_STATUS_META[c.status];
          const due = Math.max(c.amountKopecks - c.paidKopecks, 0);
          return (
            <li key={c.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-foreground">
                  {c.streamName}
                </span>
                <Badge variant={meta.variant} className="shrink-0">
                  {meta.label}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">Начислено</dt>
                  <dd className="tabular-nums">{formatKopecks(c.amountKopecks)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">Оплачено</dt>
                  <dd className="tabular-nums">{formatKopecks(c.paidKopecks)}</dd>
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
            </li>
          );
        })}
      </ul>
    </>
  );

  // ——— Список «Мои заявки» (requests) со статусами и превью скрина в Dialog. ———
  const requestsView = requestsError ? (
    <Alert variant="destructive">
      <AlertDescription>{requestsError}</AlertDescription>
    </Alert>
  ) : requestsLoading ? (
    <div className="flex justify-center py-6">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  ) : requests.length === 0 ? (
    <EmptyState icon={Inbox} title="Заявок пока нет" />
  ) : (
    <ul className="divide-y">
      {requests.map((req) => (
        <li
          key={req.id}
          className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[req.status]}>
                  {TOPUP_STATUS_LABELS[req.status]}
                </Badge>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {new Date(req.createdAt).toLocaleString('ru-RU')}
                </span>
              </div>
              <div className="text-sm text-foreground">
                {req.claimedAmountKopecks != null && (
                  <span>Заявлено: {formatKopecks(req.claimedAmountKopecks)}</span>
                )}
                {req.status === 'approved' && req.creditedAmountKopecks != null && (
                  <span className="ml-2 font-medium">
                    Зачислено: {formatKopecks(req.creditedAmountKopecks)}
                  </span>
                )}
                {req.claimedAmountKopecks == null && req.status !== 'approved' && (
                  <span className="text-muted-foreground">Сумма не указана</span>
                )}
              </div>
              {req.status === 'rejected' && req.note && (
                <p className="text-sm text-destructive">Причина: {req.note}</p>
              )}
            </div>
            {req.screenshotUrl && (
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 self-start overflow-hidden rounded-md border transition-opacity hover:opacity-80"
                    aria-label="Открыть скриншот"
                  >
                    {/* img, а не next/image: src — подписанный временный URL из S3 */}
                    <img
                      src={req.screenshotUrl}
                      alt="Скриншот оплаты"
                      className="size-16 object-cover"
                    />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogTitle>Скриншот оплаты</DialogTitle>
                  {/* img, а не next/image: src — подписанный временный URL из S3 */}
                  <img
                    src={req.screenshotUrl}
                    alt="Скриншот оплаты"
                    className="max-h-[75vh] w-full rounded-lg object-contain"
                  />
                </DialogContent>
              </Dialog>
            )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Баланс</h1>
        <p className="text-sm text-muted-foreground">Баланс, оплата и история операций</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && balanceKopecks === null ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ============ БЛОК 1 — «Оплата» ============ */}
          <Card>
            <CardHeader>
              <CardTitle>Оплата</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {/* 1) Сводка: hero-баланс, ниже — состояние «К оплате». */}
              <div className="flex flex-col gap-4">
                {/* Текущий баланс — главный показатель (hero), без обёртки-коробки. */}
                <div>
                  <div className="flex items-center gap-2">
                    <Wallet className="size-5 text-muted-foreground" />
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Текущий баланс
                    </span>
                  </div>
                  <p className="mt-2 text-4xl font-bold tabular-nums text-foreground">
                    {formatKopecks(balanceKopecks ?? 0)}
                  </p>
                </div>

                {/* К оплате: есть долг — акцентный Alert (destructive); чисто — спокойная
                    строка под балансом, отделённая Separator. */}
                {hasDebt ? (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertTitle className="tabular-nums">
                      К оплате: {formatKopecks(outstandingKopecks)}
                    </AlertTitle>
                    {/* Edge: есть долг, но нет групп со ссылкой — подсказываем, как платить. */}
                    {payableStreams.length === 0 && (
                      <AlertDescription>
                        Оплатите по ссылке вашей группы или сообщите преподавателю.
                      </AlertDescription>
                    )}
                  </Alert>
                ) : (
                  <>
                    <Separator />
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="size-4" />
                      <span>К оплате: задолженности нет</span>
                    </div>
                  </>
                )}
              </div>

              {/* 2) Секция «Оплатить» — группы со ссылкой на оплату. Скрыта, если групп нет. */}
              {payableStreams.length > 0 && (
                <>
                  <Separator />
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Оплатить</h3>
                    <ul className="flex flex-col gap-3">
                      {payableStreams.map((stream) => (
                        <li
                          key={stream.id}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {stream.name}
                          </span>
                          <Button asChild className="shrink-0">
                            <a
                              href={stream.paymentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Оплатить
                              <ExternalLink />
                            </a>
                          </Button>
                        </li>
                      ))}
                    </ul>
                    {/* Дисклеймер про обязательный скриншот — прямо под кнопками. */}
                    <Alert>
                      <Info />
                      <AlertDescription>{SCREENSHOT_DISCLAIMER}</AlertDescription>
                    </Alert>
                  </div>
                </>
              )}

              {/* 3) Ближайшее списание — строка под «Оплатить». Скрыта, если месячных групп нет. */}
              {nextCharges.length > 0 && (() => {
                // Предупреждаем о нехватке только когда долга нет (долг важнее).
                const warn = !hasDebt && nextCharges.some((c) => c.willGoIntoDebt);
                // Самая ранняя дата, до которой стоит пополнить.
                const earliest = nextCharges
                  .map((c) => c.nextChargeDate)
                  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
                const multiple = nextCharges.length > 1;
                return (
                  <>
                    <Separator />
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <CalendarClock
                          aria-hidden="true"
                          className={`size-4 ${warn ? 'text-warning' : 'text-muted-foreground'}`}
                        />
                        <span
                          className={`text-sm font-medium ${
                            warn ? 'text-warning' : 'text-muted-foreground'
                          }`}
                        >
                          {multiple ? 'Ближайшие списания' : 'Ближайшее списание'}
                        </span>
                      </div>

                      <ul className="flex flex-col gap-1">
                        {nextCharges.map((c) => (
                          <li key={c.streamId} className="text-sm text-foreground">
                            {formatChargeDate(c.nextChargeDate)} —{' '}
                            <span className="font-semibold tabular-nums">
                              {formatKopecks(c.amountKopecks)}
                            </span>
                            <span className="text-muted-foreground">
                              {' · ежемесячно, «'}
                              {c.streamName}
                              {'»'}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {warn && (
                        <p className="text-sm text-warning">
                          На балансе может не хватить — пополните до {formatChargeDate(earliest)}.
                        </p>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* 4) Секция «Уже оплатили?» — форма «Я оплатил» в Collapsible. */}
              <Separator />
              <Collapsible
                open={payFormOpen ?? false}
                onOpenChange={setPayFormOpen}
                className="flex flex-col gap-4"
              >
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    Я оплатил
                    <ChevronsUpDown className="size-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>{payForm}</CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* ============ БЛОК 2 — «История и начисления» ============ */}
          <Card>
            <CardHeader>
              <CardTitle>История и начисления</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Десктоп: Tabs */}
              <div className="hidden sm:block">
                <Tabs defaultValue="transactions">
                  <TabsList>
                    <TabsTrigger value="transactions">Операции</TabsTrigger>
                    <TabsTrigger value="charges">По группам</TabsTrigger>
                    <TabsTrigger value="requests">Мои заявки</TabsTrigger>
                  </TabsList>
                  <TabsContent value="transactions" className="pt-4">
                    {transactionsView}
                  </TabsContent>
                  <TabsContent value="charges" className="pt-4">
                    {chargesView}
                  </TabsContent>
                  <TabsContent value="requests" className="pt-4">
                    {requestsView}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Мобильные: Accordion (табы слишком тесные на ~360px). */}
              <Accordion
                type="single"
                collapsible
                defaultValue="transactions"
                className="sm:hidden"
              >
                <AccordionItem value="transactions">
                  <AccordionTrigger>Операции</AccordionTrigger>
                  <AccordionContent>{transactionsView}</AccordionContent>
                </AccordionItem>
                <AccordionItem value="charges">
                  <AccordionTrigger>По группам</AccordionTrigger>
                  <AccordionContent>{chargesView}</AccordionContent>
                </AccordionItem>
                <AccordionItem value="requests">
                  <AccordionTrigger>Мои заявки</AccordionTrigger>
                  <AccordionContent>{requestsView}</AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
