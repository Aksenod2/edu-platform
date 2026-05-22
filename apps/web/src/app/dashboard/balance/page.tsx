'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getWallet,
  formatKopecks,
  type WalletTransaction,
} from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function StudentBalancePage() {
  const { user, accessToken } = useAuth();

  const [balanceKopecks, setBalanceKopecks] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchWallet = useCallback(async () => {
    if (!accessToken || !user) return;
    setLoading(true);
    try {
      const data = await getWallet(accessToken, user.id);
      setBalanceKopecks(data.balanceKopecks);
      setTransactions(data.transactions);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки баланса');
    } finally {
      setLoading(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Баланс</h1>
        <p className="text-sm text-muted-foreground">Ваш баланс и история операций</p>
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

          {/* История операций */}
          <section>
            <h2 className="mb-3 text-xl font-bold tracking-tight text-foreground">
              История операций
            </h2>
            {transactions.length === 0 ? (
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
                            {isTopup ? '+' : '−'}{formatKopecks(tx.amount)}
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
