import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые вызывает walletRoutes (DB-free).
vi.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    walletTransaction: { create: vi.fn(), findMany: vi.fn() },
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

  it('успех (admin) — вызывает $transaction и возвращает balanceKopecks + transaction', async () => {
    // первый findUnique — студент; второй — имя админа
    db.user.findUnique
      .mockResolvedValueOnce({ role: 'student', balanceKopecks: 5000, name: 'Студент' })
      .mockResolvedValueOnce({ name: 'Админ' });
    const tx = { id: 'tx-1', kind: 'topup', amount: 1000 };
    db.$transaction.mockResolvedValueOnce([{ balanceKopecks: 6000 }, tx]);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/topup',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000, note: 'перевод' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // wallet использует массивную форму $transaction([...])
    expect(Array.isArray(db.$transaction.mock.calls[0][0])).toBe(true);
    const body = res.json();
    expect(body.balanceKopecks).toBe(6000);
    expect(body.transaction).toEqual(tx);
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

  it('успех — списание при достаточном балансе', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ role: 'student', balanceKopecks: 5000, name: 'Студент' })
      .mockResolvedValueOnce({ name: 'Админ' });
    const tx = { id: 'tx-2', kind: 'debit', amount: 1000 };
    db.$transaction.mockResolvedValueOnce([{ balanceKopecks: 4000 }, tx]);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/students/s-1/wallet/debit',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });

    expect(res.statusCode).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
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

  it('200 — админ', async () => {
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 3000, role: 'student' });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
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
  });

  it('200 — сам студент (token userId === :id)', async () => {
    db.user.findUnique.mockResolvedValueOnce({ balanceKopecks: 1500, role: 'student' });
    db.walletTransaction.findMany.mockResolvedValueOnce([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/students/s-1/wallet',
      headers: authHeaders(studentToken('s-1')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().balanceKopecks).toBe(1500);
  });
});
