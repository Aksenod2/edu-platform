'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, Wallet, ExternalLink, Upload, X, TriangleAlert, CheckCircle2, CalendarClock, CreditCard } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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

// Дата ISO → «5 июня 2026» (день числом + месяц словами), для блока «Следующее списание».
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

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Баланс</h1>
        <p className="text-sm text-muted-foreground">Ваш баланс, пополнение и история операций</p>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && balanceKopecks === null ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {/* Баланс + заметная плашка «К оплате» рядом, чтобы долг был на виду. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Текущий баланс */}
            <Card>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Wallet className="size-5 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                    Текущий баланс
                  </span>
                </div>
                <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
                  {formatKopecks(balanceKopecks ?? 0)}
                </p>
              </CardContent>
            </Card>

            {/* Долг: заметно при наличии (акцент через destructive-токены), спокойно — когда чисто. */}
            {outstandingKopecks > 0 ? (
              <Card className="border-destructive/40 bg-destructive/10">
                <CardContent>
                  <div className="flex items-center gap-3">
                    <TriangleAlert className="size-5 text-destructive" />
                    <span className="font-mono text-xs uppercase tracking-wider text-destructive">
                      К оплате
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-destructive">
                    {formatKopecks(outstandingKopecks)}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="size-5 text-muted-foreground" />
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      К оплате
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">Задолженности нет</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Оплата групп: активные группы с внешней ссылкой на оплату.
              Показываем ВСЕГДА, когда массив непустой; иначе блок не рендерим. */}
          {payableStreams.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Оплата групп</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {payableStreams.map((stream) => (
                    <li
                      key={stream.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <CreditCard
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {stream.name}
                        </span>
                      </div>
                      <Button asChild size="sm" className="shrink-0">
                        <a
                          href={stream.paymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink />
                          Оплатить
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Следующее списание (менторские группы). Скрыт, если месячных групп нет.
              Акцент один: при долге («К оплате») блок мягкий/нейтральный, иначе при
              нехватке баланса — тон warning. */}
          {nextCharges.length > 0 && (() => {
            const hasDebt = outstandingKopecks > 0;
            // Предупреждаем о нехватке только когда долга нет (долг важнее).
            const warn = !hasDebt && nextCharges.some((c) => c.willGoIntoDebt);
            // Самая ранняя дата, до которой стоит пополнить.
            const earliest = nextCharges
              .map((c) => c.nextChargeDate)
              .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
            const multiple = nextCharges.length > 1;
            return (
              <Card
                className={
                  warn ? 'border-warning/40 bg-warning/10' : undefined
                }
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock
                      aria-hidden="true"
                      className={`size-4 ${warn ? 'text-warning' : 'text-muted-foreground'}`}
                    />
                    <span
                      className={`font-mono text-xs uppercase tracking-wider ${
                        warn ? 'text-warning' : 'text-muted-foreground'
                      }`}
                    >
                      {multiple ? 'Следующие списания' : 'Следующее списание'}
                    </span>
                  </div>

                  <ul className="flex flex-col gap-2">
                    {nextCharges.map((c) => (
                      <li
                        key={c.streamId}
                        className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                      >
                        <span className="text-sm text-foreground">
                          {formatChargeDate(c.nextChargeDate)}
                          {multiple && (
                            <span className="text-muted-foreground"> · {c.streamName}</span>
                          )}
                        </span>
                        <span className="text-sm">
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatKopecks(c.amountKopecks)}
                          </span>
                          <span className="text-muted-foreground">
                            {' '}
                            · за менторскую группу, ежемесячно
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {warn && (
                    <p className="text-sm text-warning">
                      На балансе может не хватить — пополните до {formatChargeDate(earliest)}.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Начисления по группам (платёжный план). Показываем только если есть. */}
          {charges.length > 0 && (
            <section className="flex flex-col gap-3">
              <Card>
                <CardHeader>
                  <CardTitle>По группам</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Десктоп: таблица */}
                  <div className="hidden rounded-lg border sm:block">
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

                  {/* Мобильные: карточки-стек */}
                  <ul className="flex flex-col gap-3 sm:hidden">
                    {charges.map((c) => {
                      const meta = CHARGE_STATUS_META[c.status];
                      const due = Math.max(c.amountKopecks - c.paidKopecks, 0);
                      return (
                        <li key={c.id} className="rounded-lg border p-4">
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
                </CardContent>
              </Card>
            </section>
          )}

          {/* Форма «Я оплатил» */}
          <div id="topup" className="scroll-mt-20">
            <Card>
              <CardHeader>
                <CardTitle>Я оплатил</CardTitle>
              </CardHeader>
              <CardContent>
                {hasPending && (
                  <Alert className="mb-4">
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
              </CardContent>
            </Card>
          </div>

          {/* Мои заявки на пополнение */}
          <section>
            <h2 className="mb-3 text-xl font-bold tracking-tight text-foreground">Мои заявки</h2>
            {requestsError ? (
              <Alert variant="destructive">
                <AlertDescription>{requestsError}</AlertDescription>
              </Alert>
            ) : requestsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {requests.map((req) => (
                  <Card key={req.id}>
                    <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <Separator />

          {/* История операций */}
          <section>
            <h2 className="mb-3 text-xl font-bold tracking-tight text-foreground">
              История операций
            </h2>
            {error ? (
              <p className="text-sm text-destructive">Не удалось загрузить историю операций.</p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Операций пока нет.</p>
            ) : (
              <div className="rounded-lg border">
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
            )}
          </section>
        </div>
      )}
    </>
  );
}
