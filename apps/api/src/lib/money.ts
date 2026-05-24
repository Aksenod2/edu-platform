import type { Prisma, WalletTransaction } from '@platform/db';

// Деньги в проекте хранятся/передаются в КОПЕЙКАХ (целое число), UI показывает рубли.
// Здесь — общие хелперы для денежных операций, переиспользуемые между роутами
// (wallet.ts — ручное пополнение/списание админом; payments.ts — заявки студентов).

// Верхняя граница любой денежной величины (копейки). 100 000 000 коп. = 1 000 000 ₽.
// Защита от абсурдных значений И от переполнения колонок Int4 в PostgreSQL
// (макс. 2_147_483_647): и сумма заявки/операции, и цена группы должны быть ≤ этого
// потолка. Единый источник правды для всех денежных полей (payments.ts, streams.ts).
export const MAX_AMOUNT_KOPECKS = 100_000_000;

// Проверка: положительное целое число копеек (защита от NaN/дробей/отрицательных).
export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

// Проверка: неотрицательное целое число копеек (для цены группы, где 0 допустим).
export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// Транзакционный клиент Prisma внутри $transaction(async (tx) => ...) или обычный prisma.
type Tx = Prisma.TransactionClient;

// Сентинел-ошибка: на балансе недостаточно средств для списания. Бросается debitBalance,
// чтобы вызывающий мог отличить «нет денег» от прочих сбоев и вернуть понятный 400.
export class InsufficientFundsError extends Error {
  constructor(message = 'Недостаточно средств') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

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
    // Начисление за группу, к которому относится пополнение (например возврат). Опционально.
    chargeId?: string | null;
  },
): Promise<{ balanceKopecks: number; transaction: WalletTransaction }> {
  const { userId, amountKopecks } = params;
  const note = params.note ?? null;
  const createdBy = params.createdBy ?? null;
  const chargeId = params.chargeId ?? null;

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
      chargeId,
    },
  });

  return { balanceKopecks: updatedUser.balanceKopecks, transaction };
}

/**
 * Атомарно списывает средства с баланса пользователя и пишет запись истории (kind: 'debit').
 *
 * ИНВАРИАНТ «баланс не уходит в минус»: списание делается УСЛОВНЫМ updateMany с фильтром
 * `balanceKopecks >= amountKopecks`. Если средств недостаточно, обновится 0 строк — тогда
 * бросаем InsufficientFundsError (никаких записей истории). Это и атомарно (фильтр+decrement
 * в одном запросе, защита от гонок), и не уводит баланс в минус.
 *
 * Вызывается ВНУТРИ prisma.$transaction((tx) => ...): атомарность связки «списание + запись
 * истории + (опц.) погашение Charge» обеспечивает вызывающий, передавая `tx`.
 *
 * chargeId — начисление за группу, которое гасит это списание (несколько списаний могут гасить
 * одно начисление). createdBy — имя/идентификатор инициатора (для атрибуции в истории).
 */
export async function debitBalance(
  tx: Tx,
  params: {
    userId: string;
    amountKopecks: number;
    note?: string | null;
    createdBy?: string | null;
    chargeId?: string | null;
  },
): Promise<{ balanceKopecks: number; transaction: WalletTransaction }> {
  const { userId, amountKopecks } = params;
  const note = params.note ?? null;
  const createdBy = params.createdBy ?? null;
  const chargeId = params.chargeId ?? null;

  // Условное списание: затронет строку, только если на балансе достаточно средств.
  const decremented = await tx.user.updateMany({
    where: { id: userId, balanceKopecks: { gte: amountKopecks } },
    data: { balanceKopecks: { decrement: amountKopecks } },
  });

  if (decremented.count !== 1) {
    // 0 строк — недостаточно средств (или гонка). Баланс не тронут, истории нет.
    throw new InsufficientFundsError('Недостаточно средств');
  }

  const transaction = await tx.walletTransaction.create({
    data: {
      userId,
      amount: amountKopecks,
      kind: 'debit',
      note,
      createdBy,
      chargeId,
    },
  });

  // Читаем актуальный баланс отдельно (updateMany не возвращает строку).
  const fresh = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { balanceKopecks: true },
  });

  return { balanceKopecks: fresh.balanceKopecks, transaction };
}
