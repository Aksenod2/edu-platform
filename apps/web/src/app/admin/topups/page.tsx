'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  getAdminTopUpRequests,
  approveTopUp,
  rejectTopUp,
  formatKopecks,
  TOPUP_STATUS_LABELS,
  type TopUpRequest,
  type TopUpRequestStatus,
} from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type FilterValue = TopUpRequestStatus | 'all';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'pending', label: 'Ожидают' },
  { value: 'approved', label: 'Одобрены' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'all', label: 'Все' },
];

const STATUS_VARIANT: Record<TopUpRequestStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  approved: 'default',
  rejected: 'destructive',
};

export default function AdminTopupsPage() {
  const { accessToken } = useAuth();

  const [filter, setFilter] = useState<FilterValue>('pending');
  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchRequests = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await getAdminTopUpRequests(accessToken, filter);
      setRequests(data.requests);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки заявок');
    } finally {
      setLoading(false);
    }
  }, [accessToken, filter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Пополнения</h1>
        <p className="text-sm text-muted-foreground">
          Заявки студентов на пополнение баланса
        </p>
      </div>

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as FilterValue)}
        className="mt-4"
      >
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {filter === 'pending' ? 'Нет заявок на рассмотрении.' : 'Заявок нет.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((req) => (
              <TopUpCard key={req.id} request={req} onChanged={fetchRequests} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TopUpCard({
  request,
  onChanged,
}: {
  request: TopUpRequest;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();

  // Поле фактической суммы предзаполняется заявленной (в рублях).
  const initialRubles =
    request.claimedAmountKopecks != null
      ? String(request.claimedAmountKopecks / 100)
      : '';
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [amountRubles, setAmountRubles] = useState(initialRubles);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  const isPending = request.status === 'pending';

  async function handleApprove() {
    if (!accessToken) return;
    const rubles = Number(amountRubles.replace(',', '.'));
    if (!Number.isFinite(rubles) || rubles <= 0) {
      toast.error('Укажите корректную сумму для зачисления');
      return;
    }
    setBusy(true);
    try {
      await approveTopUp(accessToken, request.id, Math.round(rubles * 100));
      toast.success('Заявка одобрена, средства зачислены');
      setApproveOpen(false);
      onChanged();
    } catch (err) {
      // 409 — заявка уже обработана другим админом: показываем причину и рефетчим.
      toast.error(err instanceof Error ? err.message : 'Не удалось одобрить заявку');
      setApproveOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!accessToken) return;
    setBusy(true);
    try {
      await rejectTopUp(accessToken, request.id, rejectNote.trim() || undefined);
      toast.success('Заявка отклонена');
      setRejectOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось отклонить заявку');
      setRejectOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-4">
          {request.screenshotUrl && (
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 overflow-hidden rounded-md border transition-opacity hover:opacity-80"
                  aria-label="Открыть скриншот"
                >
                  {/* img, а не next/image: src — подписанный временный URL из S3 */}
                  <img
                    src={request.screenshotUrl}
                    alt="Скриншот оплаты"
                    className="size-20 object-cover"
                  />
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogTitle>Скриншот оплаты</DialogTitle>
                {/* img, а не next/image: src — подписанный временный URL из S3 */}
                <img
                  src={request.screenshotUrl}
                  alt="Скриншот оплаты"
                  className="max-h-[75vh] w-full rounded-lg object-contain"
                />
              </DialogContent>
            </Dialog>
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium text-foreground">
                {request.user?.name ?? 'Студент'}
              </span>
              <Badge variant={STATUS_VARIANT[request.status]}>
                {TOPUP_STATUS_LABELS[request.status]}
              </Badge>
            </div>
            {request.user?.email && (
              <span className="truncate text-xs text-muted-foreground">
                {request.user.email}
              </span>
            )}
            <div className="mt-1 text-sm text-foreground">
              {request.claimedAmountKopecks != null ? (
                <span>Заявлено: {formatKopecks(request.claimedAmountKopecks)}</span>
              ) : (
                <span className="text-muted-foreground">Сумма не указана</span>
              )}
              {request.status === 'approved' && request.creditedAmountKopecks != null && (
                <span className="ml-2 font-medium">
                  Зачислено: {formatKopecks(request.creditedAmountKopecks)}
                </span>
              )}
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {new Date(request.createdAt).toLocaleString('ru-RU')}
            </span>
            {request.note && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {request.status === 'rejected' ? 'Причина отклонения: ' : 'Комментарий: '}
                {request.note}
              </p>
            )}
          </div>
        </div>

        {isPending && (
          <div className="flex shrink-0 gap-2">
            {/* Одобрить */}
            <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Одобрить</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Одобрить заявку</DialogTitle>
                  <DialogDescription>
                    Укажите фактическую сумму, которая будет зачислена на баланс студента.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`amount-${request.id}`}>Сумма к зачислению, ₽</Label>
                  <Input
                    id={`amount-${request.id}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amountRubles}
                    onChange={(e) => setAmountRubles(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setApproveOpen(false)}
                    disabled={busy}
                  >
                    Отмена
                  </Button>
                  <Button onClick={handleApprove} disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />}
                    Зачислить
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Отклонить */}
            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Отклонить
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Отклонить заявку</DialogTitle>
                  <DialogDescription>
                    Опционально укажите причину — студент увидит её в своих заявках.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`note-${request.id}`}>Причина отклонения</Label>
                  <Textarea
                    id={`note-${request.id}`}
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Необязательно"
                    rows={3}
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setRejectOpen(false)}
                    disabled={busy}
                  >
                    Отмена
                  </Button>
                  <Button variant="destructive" onClick={handleReject} disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />}
                    Отклонить
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
