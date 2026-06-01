import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые вызывает walletRoutes (DB-free).
vi.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    walletTransaction: { create: vi.fn(), findMany: vi.fn() },
    charge: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    streamEnrollment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { walletRoutes } from '../wallet.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(walletRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });
const studentToken = (id: string) => signAccessToken({ userId: id, role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Мок callback-формы $transaction: вызывает колбэк с tx-объектом из методов prisma-мока
// (как ведёт себя реальный интерактивный $transaction).
function mockTxCallback() {
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      user: db.user,
      walletTransaction: db.walletTransaction,
      charge: db.charge,
    };
    return cb(tx);
  });
}

describe('POST /students/:id/wallet/topup', () => {
  it('400 — amountKopecks отсутствует', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { note: 'без суммы' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('400 — amountKopecks = 0', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('400 — amountKopecks отрицательный', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: -500 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('400 — amountKopecks дробный (не целое)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 100.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('400 — amountKopecks превышает потолок MAX_AMOUNT_KOPECKS', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 100_000_001 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('404 — целевой пользователь не студент', async () => {
    db.user.findUnique.mockResolvedValueOnce({ role: 'admin', balanceKopecks: 0, name: 'Не студент' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });
    expect(res.statusCode).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('успех (admin) — без открытых начислений: зачисляет баланс, ничего не гасит', async () => {
    // первый findUnique — студент; второй — имя админа
    db.user.findUnique
      .mockResolvedValueOnce({ role: 'student', balanceKopecks: 5000, name: 'Студент' })
      .mockResolvedValueOnce({ name: 'Админ' });
    mockTxCallback();
    // creditBalance: user.update (новый баланс) + walletTransaction.create
    db.user.update.mockResolvedValueOnce({ balanceKopecks: 6000 });
    const tx = { id: 'tx-1', kind: 'topup', amount: 1000 };
    db.walletTransaction.create.mockResolvedValueOnce(tx);
    // settleOutstandingCharges: открытых начислений нет → ничего не гасит.
    db.charge.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000, note: 'перевод' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // wallet теперь использует интерактивную форму $transaction(async (tx) => ...)
    expect(typeof db.$transaction.mock.calls[0][0]).toBe('function');
    const body = res.json();
    expect(body.balanceKopecks).toBe(6000);
    expect(body.transaction).toEqual(tx);
    expect(body.settledKopecks).toBe(0);
    // Долг не гасили — balanceKopecks не перечитывали повторно.
    expect(db.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('успех — пополнение ПОЛНОСТЬЮ гасит открытое начисление → status=paid', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ role: 'student', balanceKopecks: 0, name: 'Студент' })
      .mockResolvedValueOnce({ name: 'Админ' });
    mockTxCallback();
    // creditBalance: зачислили 10000 → баланс 10000
    db.user.update.mockResolvedValueOnce({ balanceKopecks: 10000 });
    const topupTx = { id: 'tx-topup', kind: 'topup', amount: 10000 };
    db.walletTransaction.create
      .mockResolvedValueOnce(topupTx) // topup в creditBalance
      .mockResolvedValueOnce({ id: 'tx-debit', kind: 'debit', amount: 10000 }); // debit в settle
    // settleOutstandingCharges: одно открытое начисление на 10000 (paid 0)
    db.charge.findMany.mockResolvedValueOnce([
      { id: 'c-1', amountKopecks: 10000, paidKopecks: 0, status: 'open' },
    ]);
    // findUniqueOrThrow вызывается трижды: (1) available в settle, (2) fresh-баланс
    // в debitBalance, (3) перечитанный баланс в обработчике после погашения.
    db.user.findUniqueOrThrow
      .mockResolvedValueOnce({ balanceKopecks: 10000 }) // available в settle
      .mockResolvedValueOnce({ balanceKopecks: 0 }) // fresh в debitBalance
      .mockResolvedValueOnce({ balanceKopecks: 0 }); // перечитанный после погашения
    // debitBalance внутри settle: условное updateMany (count 1)
    db.user.updateMany.mockResolvedValueOnce({ count: 1 });
    // charge.update increment → полностью погашено
    db.charge.update.mockResolvedValueOnce({ id: 'c-1', amountKopecks: 10000, paidKopecks: 10000 });
    db.charge.updateMany.mockResolvedValueOnce({ count: 1 });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 10000 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Весь баланс ушёл на погашение долга.
    expect(body.balanceKopecks).toBe(0);
    expect(body.settledKopecks).toBe(10000);
    expect(body.transaction).toEqual(topupTx);
    // Полное погашение → перевод начисления в 'paid' (условие на status='open').
    expect(db.charge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1', status: 'open' },
        data: { status: 'paid' },
      }),
    );
  });

  it('успех — пополнение ЧАСТИЧНО гасит начисление → остаётся открытым (partial)', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ role: 'student', balanceKopecks: 0, name: 'Студент' })
      .mockResolvedValueOnce({ name: 'Админ' });
    mockTxCallback();
    // creditBalance: зачислили 3000 → баланс 3000
    db.user.update.mockResolvedValueOnce({ balanceKopecks: 3000 });
    const topupTx = { id: 'tx-topup', kind: 'topup', amount: 3000 };
    db.walletTransaction.create
      .mockResolvedValueOnce(topupTx)
      .mockResolvedValueOnce({ id: 'tx-debit', kind: 'debit', amount: 3000 });
    // открытое начисление на 10000 — средств хватит только частично (3000).
    db.charge.findMany.mockResolvedValueOnce([
      { id: 'c-1', amountKopecks: 10000, paidKopecks: 0, status: 'open' },
    ]);
    db.user.findUniqueOrThrow
      .mockResolvedValueOnce({ balanceKopecks: 3000 }) // available в settle
      .mockResolvedValueOnce({ balanceKopecks: 0 }) // fresh в debitBalance
      .mockResolvedValueOnce({ balanceKopecks: 0 }); // после погашения
    db.user.updateMany.mockResolvedValueOnce({ count: 1 });
    // increment paidKopecks → 3000 < 10000, начисление НЕ закрывается.
    db.charge.update.mockResolvedValueOnce({ id: 'c-1', amountKopecks: 10000, paidKopecks: 3000 });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 3000 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balanceKopecks).toBe(0);
    expect(body.settledKopecks).toBe(3000);
    // Частичное погашение — начисление в 'paid' НЕ переводим.
    expect(db.charge.updateMany).not.toHaveBeenCalled();
  });

  it('403 — не админ (студент) не может пополнять', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(studentToken('s-1')),
      payload: { amountKopecks: 1000 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /students/:id/wallet/debit', () => {
  it('400 «Недостаточно средств» — баланс меньше суммы', async () => {
    db.user.findUnique.mockResolvedValueOnce({ role: 'student', balanceKopecks: 500, name: 'Студент' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/debit',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Недостаточно средств');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('успех — списание при достаточном балансе (через debitBalance)', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ role: 'student', balanceKopecks: 5000, name: 'Студент' })
      .mockResolvedValueOnce({ name: 'Админ' });
    mockTxCallback();
    // debitBalance: условное updateMany (count 1) + walletTransaction.create + чтение баланса
    db.user.updateMany.mockResolvedValueOnce({ count: 1 });
    const tx = { id: 'tx-2', kind: 'debit', amount: 1000 };
    db.walletTransaction.create.mockResolvedValueOnce(tx);
    db.user.findUniqueOrThrow.mockResolvedValueOnce({ balanceKopecks: 4000 });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/debit',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });

    expect(res.statusCode).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // Списание условным updateMany с фильтром по балансу (не уводит в минус).
    expect(db.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's-1', balanceKopecks: { gte: 1000 } },
        data: { balanceKopecks: { decrement: 1000 } },
      }),
    );
    const body = res.json();
    expect(body.balanceKopecks).toBe(4000);
    expect(body.transaction).toEqual(tx);
  });

  it('400 — невалидная сумма (0)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/debit',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('400 — amountKopecks превышает потолок MAX_AMOUNT_KOPECKS', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/debit',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 100_000_001 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('GET /students/:id/wallet', () => {
  it('403 — другой студент (token userId !== :id)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(studentToken('s-2')),
    });
    expect(res.statusCode).toBe(403);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('200 — админ: баланс, история, charges и outstandingKopecks', async () => {
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 3000, role: 'student', isDemo: false });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
    // 1-й вызов — прогноз месячных списаний; 2-й — payableStreams (группы со ссылкой).
    db.streamEnrollment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    db.charge.findMany.mockResolvedValueOnce([
      {
        id: 'c-1',
        streamId: 'st-1',
        amountKopecks: 10000,
        paidKopecks: 3000,
        status: 'open',
        stream: { name: 'Поток А' },
      },
      {
        id: 'c-2',
        streamId: 'st-2',
        amountKopecks: 5000,
        paidKopecks: 5000,
        status: 'paid',
        stream: { name: 'Поток Б' },
      },
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balanceKopecks).toBe(3000);
    expect(body.transactions).toEqual([]);
    expect(body.charges).toHaveLength(2);
    expect(body.charges[0]).toMatchObject({
      streamId: 'st-1',
      streamName: 'Поток А',
      amountKopecks: 10000,
      paidKopecks: 3000,
      status: 'open',
    });
    // outstanding = только по open: 10000 - 3000 = 7000 (paid не учитывается).
    expect(body.outstandingKopecks).toBe(7000);
  });

  it('200 — сам студент (token userId === :id)', async () => {
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 1500, role: 'student', isDemo: false });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
    db.streamEnrollment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    db.charge.findMany.mockResolvedValueOnce([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(studentToken('s-1')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().balanceKopecks).toBe(1500);
    expect(res.json().outstandingKopecks).toBe(0);
    expect(res.json().nextMentorshipCharges).toEqual([]);
    expect(res.json().payableStreams).toEqual([]);
  });

  it('200 — payableStreams: только активные группы студента со ссылкой на оплату', async () => {
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 0, role: 'student', isDemo: false });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
    db.charge.findMany.mockResolvedValueOnce([]);
    // 1-й вызов — прогноз (пусто); 2-й — payableStreams.
    db.streamEnrollment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { stream: { id: 'st-1', name: 'Группа со ссылкой', paymentUrl: 'https://pay.example/abc' } },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(studentToken('s-1')),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.payableStreams).toEqual([
      { id: 'st-1', name: 'Группа со ссылкой', paymentUrl: 'https://pay.example/abc' },
    ]);
    // Выборка ограничена активными группами студента с непустым paymentUrl.
    expect(db.streamEnrollment.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 's-1',
          stream: expect.objectContaining({ status: 'active', paymentUrl: { not: null } }),
        }),
      }),
    );
  });
});

describe('GET /students/:id/wallet — nextMentorshipCharges (прогноз месячных списаний)', () => {
  it('200 — отдаёт ближайшие списания по активным monthly-группам + признак нехватки', async () => {
    // Баланс 100000; одна monthly-группа на 500000 → willGoIntoDebt=true.
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 100000, role: 'student', isDemo: false });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
    db.charge.findMany.mockResolvedValueOnce([]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([
        {
          stream: {
            id: 'st-1',
            name: 'Менторская',
            monthlyPriceKopecks: 500000,
            billingDayOfMonth: 15,
          },
        },
      ])
      // 2-й вызов — payableStreams (в этом тесте не проверяем, пусто).
      .mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nextMentorshipCharges).toHaveLength(1);
    expect(body.nextMentorshipCharges[0]).toMatchObject({
      streamId: 'st-1',
      streamName: 'Менторская',
      amountKopecks: 500000,
      willGoIntoDebt: true,
    });
    // Дата следующего списания — валидный ISO.
    expect(typeof body.nextMentorshipCharges[0].nextChargeDate).toBe('string');
    expect(Number.isNaN(Date.parse(body.nextMentorshipCharges[0].nextChargeDate))).toBe(false);
    // Выборка зачислений ограничена активными monthly-группами с планом.
    expect(db.streamEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 's-1',
          stream: expect.objectContaining({
            status: 'active',
            billingType: 'monthly',
            monthlyPriceKopecks: { gt: 0 },
            billingDayOfMonth: { not: null },
          }),
        }),
      }),
    );
  });

  it('200 — баланса хватает → willGoIntoDebt=false', async () => {
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 600000, role: 'student', isDemo: false });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
    db.charge.findMany.mockResolvedValueOnce([]);
    db.streamEnrollment.findMany
      .mockResolvedValueOnce([
        { stream: { id: 'st-1', name: 'Менторская', monthlyPriceKopecks: 500000, billingDayOfMonth: 15 } },
      ])
      .mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(adminToken),
    });

    expect(res.json().nextMentorshipCharges[0].willGoIntoDebt).toBe(false);
  });

  it('200 — демо-студент: прогноз списаний пуст, но ссылка на оплату группы показывается', async () => {
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 0, role: 'student', isDemo: true });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
    // У демо месячный прогноз пропускается, но payable-запрос (ссылка на оплату) всё равно
    // выполняется — она показывается ВСЕМ студентам, включая демо (см. routes/wallet.ts).
    db.streamEnrollment.findMany.mockResolvedValueOnce([
      { stream: { id: 'st-9', name: 'Группа', paymentUrl: 'https://pay.example/st-9' } },
    ]);
    db.charge.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    // Демо не списывается — прогноз месячных списаний пуст.
    expect(res.json().nextMentorshipCharges).toEqual([]);
    // Но ссылку на оплату группы демо видит.
    expect(res.json().payableStreams).toEqual([
      { id: 'st-9', name: 'Группа', paymentUrl: 'https://pay.example/st-9' },
    ]);
    // Ровно один запрос streamEnrollment.findMany (payable); месячный прогноз для демо пропущен.
    expect(db.streamEnrollment.findMany).toHaveBeenCalledTimes(1);
  });
});
