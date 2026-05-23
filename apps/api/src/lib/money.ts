import type { Prisma, WalletTransaction } from '@platform/db';

// Деньги в проекте хранятся/передаются в КОПЕЙКАХ (целое число), UI показывает рубли.
// Здесь — общие хелперы для денежных операций, переиспользуемые между роутами
// (wallet.ts — ручное пополнение/списание админом; payments.ts — заявки студентов).

// Проверка: положительное целое число копеек (защита от NaN/дробей/отрицательных).
export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

// Транзакционный клиент Prisma внутри $transaction(async (tx) => ...) или обычный prisma.
type Tx = Prisma.TransactionClient;

/**
 * Атомарно пополняет баланс пользователя и пишет запись истории (kind: 'topup').
 *
 * ВАЖНО: вызывается ВНУТРИ prisma.$transaction((tx) => ...) — атомарность инкремента
 * баланса и создания транзакции обеспечивает вызывающий, передавая `tx`. Так одобрение
 * заявки на пополнение (увеличение баланса + привязка walletTransactionId) проходит
 * единой транзакцией.
 *
 * Возвращает обновлённый баланс и созданную запись WalletTransaction.
 */
export async function creditBalance(
  tx: Tx,
  params: {
    userId: string;
    amountKopecks: number;
    note?: string | null;
    createdBy?: string | null;
  },
): Promise<{ balanceKopecks: number; transaction: WalletTransaction }> {
  const { userId, amountKopecks } = params;
  const note = params.note ?? null;
  const createdBy = params.createdBy ?? null;

  const updatedUser = await tx.user.update({
    where: { id: userId },
    data: { balanceKopecks: { increment: amountKopecks } },
    select: { balanceKopecks: true },
  });

  const transaction = await tx.walletTransaction.create({
    data: {
      userId,
      amount: amountKopecks,
      kind: 'topup',
      note,
      createdBy,
    },
  });

  return { balanceKopecks: updatedUser.balanceKopecks, transaction };
}
