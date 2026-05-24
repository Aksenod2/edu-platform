import { describe, it, expect, beforeEach, vi } from 'vitest';

// Юнит-тесты ledger «Оплата и баланс»: createCharge / settleOutstandingCharges и
// debitBalance. DB-free: tx — простой объект из vi.fn(), Prisma реэкспортируем
// настоящий (нужен Prisma.PrismaClientKnownRequestError для веток P2002).
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return { Prisma: actual.Prisma };
});

import { Prisma } from '@platform/db';
import { createCharge, settleOutstandingCharges } from '../charges.js';
import { debitBalance, InsufficientFundsError } from '../money.js';

// Фабрика мок-tx: только методы, которые трогают тестируемые функции.
function makeTx() {
  return {
    charge: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    walletTransaction: {
      create: vi.fn(),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('debitBalance', () => {
  it('списывает условным updateMany (не уводит в минус) и пишет историю kind=debit', async () => {
    const tx = makeTx();
    tx.user.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.walletTransaction.create.mockResolvedValueOnce({ id: 'wt-1', kind: 'debit', amount: 1000 });
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ balanceKopecks: 4000 });

    const res = await debitBalance(tx as AnyTx, { userId: 'u-1', amountKopecks: 1000, chargeId: 'c-1' });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', balanceKopecks: { gte: 1000 } },
      data: { balanceKopecks: { decrement: 1000 } },
    });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'debit', amount: 1000, chargeId: 'c-1' }) }),
    );
    expect(res.balanceKopecks).toBe(4000);
    expect(res.transaction.id).toBe('wt-1');
  });

  it('бросает InsufficientFundsError и не пишет историю, если средств не хватает', async () => {
    const tx = makeTx();
    tx.user.updateMany.mockResolvedValueOnce({ count: 0 }); // условие gte не выполнено

    await expect(
      debitBalance(tx as AnyTx, { userId: 'u-1', amountKopecks: 999999 }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });
});

describe('createCharge — идемпотентность', () => {
  it('возвращает существующее ОТКРЫТОЕ начисление и НЕ создаёт второе', async () => {
    const tx = makeTx();
    const existing = { id: 'c-1', streamId: 's-1', userId: 'u-1', status: 'open' };
    tx.charge.findFirst.mockResolvedValueOnce(existing);

    const res = await createCharge(tx as AnyTx, { streamId: 's-1', userId: 'u-1', amountKopecks: 10000 });

    expect(res).toBe(existing);
    expect(tx.charge.create).not.toHaveBeenCalled();
  });

  it('создаёт новое начисление, если открытого нет (после полного погашения)', async () => {
    const tx = makeTx();
    tx.charge.findFirst.mockResolvedValueOnce(null); // открытого нет
    const created = { id: 'c-2', status: 'open' };
    tx.charge.create.mockResolvedValueOnce(created);

    const res = await createCharge(tx as AnyTx, { streamId: 's-1', userId: 'u-1', amountKopecks: 10000 });

    expect(tx.charge.create).toHaveBeenCalledTimes(1);
    expect(res).toBe(created);
  });

  it('гонка P2002: возвращает уже созданное открытое начисление вместо дубля', async () => {
    const tx = makeTx();
    tx.charge.findFirst
      .mockResolvedValueOnce(null) // первая проверка — пусто
      .mockResolvedValueOnce({ id: 'c-3', status: 'open' }); // после P2002 нашли существующее
    tx.charge.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }),
    );

    const res = await createCharge(tx as AnyTx, { streamId: 's-1', userId: 'u-1', amountKopecks: 10000 });
    expect(res).toMatchObject({ id: 'c-3' });
  });
});

describe('settleOutstandingCharges — частичное погашение без минуса', () => {
  it('нет открытых начислений → 0 списаний', async () => {
    const tx = makeTx();
    tx.charge.findMany.mockResolvedValueOnce([]);
    const paid = await settleOutstandingCharges(tx as AnyTx, 'u-1');
    expect(paid).toBe(0);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('частично гасит старое начисление доступными средствами, баланс не в минус', async () => {
    const tx = makeTx();
    // Одно открытое начисление 10000, уплачено 0; баланс 3000.
    tx.charge.findMany.mockResolvedValueOnce([
      { id: 'c-1', amountKopecks: 10000, paidKopecks: 0, createdAt: new Date('2026-01-01') },
    ]);
    tx.user.findUniqueOrThrow
      .mockResolvedValueOnce({ balanceKopecks: 3000 }) // стартовый баланс
      .mockResolvedValueOnce({ balanceKopecks: 0 }); // после списания (внутри debitBalance)
    tx.user.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.walletTransaction.create.mockResolvedValueOnce({ id: 'wt-1' });
    tx.charge.update.mockResolvedValueOnce({});

    const paid = await settleOutstandingCharges(tx as AnyTx, 'u-1');

    expect(paid).toBe(3000); // min(остаток 10000, баланс 3000)
    // Списали ровно 3000 (не больше доступного).
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceKopecks: { decrement: 3000 } } }),
    );
    // Начисление осталось открытым (частично оплачено).
    expect(tx.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paidKopecks: 3000, status: 'open' } }),
    );
  });

  it('полностью гасит начисление и переводит в paid, когда средств достаточно', async () => {
    const tx = makeTx();
    tx.charge.findMany.mockResolvedValueOnce([
      { id: 'c-1', amountKopecks: 5000, paidKopecks: 1000, createdAt: new Date('2026-01-01') },
    ]);
    tx.user.findUniqueOrThrow
      .mockResolvedValueOnce({ balanceKopecks: 9000 })
      .mockResolvedValueOnce({ balanceKopecks: 5000 });
    tx.user.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.walletTransaction.create.mockResolvedValueOnce({ id: 'wt-1' });
    tx.charge.update.mockResolvedValueOnce({});

    const paid = await settleOutstandingCharges(tx as AnyTx, 'u-1');

    expect(paid).toBe(4000); // остаток 5000-1000
    expect(tx.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paidKopecks: 5000, status: 'paid' } }),
    );
  });

  it('идемпотентен: при нулевом балансе ничего не списывает', async () => {
    const tx = makeTx();
    tx.charge.findMany.mockResolvedValueOnce([
      { id: 'c-1', amountKopecks: 10000, paidKopecks: 0, createdAt: new Date('2026-01-01') },
    ]);
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ balanceKopecks: 0 });

    const paid = await settleOutstandingCharges(tx as AnyTx, 'u-1');

    expect(paid).toBe(0);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.charge.update).not.toHaveBeenCalled();
  });

  it('гасит несколько начислений по порядку (старые первыми), пока есть средства', async () => {
    const tx = makeTx();
    // Баланс 6000; два начисления: c-1 (4000) и c-2 (5000). Хватает на c-1 и часть c-2.
    tx.charge.findMany.mockResolvedValueOnce([
      { id: 'c-1', amountKopecks: 4000, paidKopecks: 0, createdAt: new Date('2026-01-01') },
      { id: 'c-2', amountKopecks: 5000, paidKopecks: 0, createdAt: new Date('2026-01-02') },
    ]);
    tx.user.findUniqueOrThrow
      .mockResolvedValueOnce({ balanceKopecks: 6000 }) // стартовый
      .mockResolvedValueOnce({ balanceKopecks: 2000 }) // после списания c-1
      .mockResolvedValueOnce({ balanceKopecks: 0 }); // после списания части c-2
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.walletTransaction.create.mockResolvedValue({ id: 'wt' });
    tx.charge.update.mockResolvedValue({});

    const paid = await settleOutstandingCharges(tx as AnyTx, 'u-1');

    expect(paid).toBe(6000);
    // c-1 закрыт полностью (4000 → paid), c-2 частично (2000 → open).
    expect(tx.charge.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'c-1' }, data: { paidKopecks: 4000, status: 'paid' } }),
    );
    expect(tx.charge.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 'c-2' }, data: { paidKopecks: 2000, status: 'open' } }),
    );
  });
});
