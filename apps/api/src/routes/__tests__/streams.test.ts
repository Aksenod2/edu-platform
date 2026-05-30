import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогают тестируемые ветки (DB-free).
// Prisma реэкспортируем настоящий (через importActual самого пакета db) — он нужен
// роуту для проверки `err instanceof Prisma.PrismaClientKnownRequestError`.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return {
    prisma: {
      stream: {
        delete: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      streamEnrollment: { findMany: vi.fn() },
      program: { findUnique: vi.fn() },
      user: { findFirst: vi.fn() },
    },
    Prisma: actual.Prisma,
  };
});

import { streamRoutes } from '../streams.js';
import { prisma, Prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import { MAX_AMOUNT_KOPECKS } from '../../lib/money.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(streamRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });
const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /streams/:id — полное удаление потока', () => {
  it('удаляет существующий поток (200) и зовёт prisma.stream.delete', async () => {
    db.stream.delete.mockResolvedValueOnce({ id: 's-1' });

    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(db.stream.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });

  it('несуществующий поток (Prisma P2025) → 404', async () => {
    db.stream.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Record to delete does not exist.', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/streams/missing',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('Группа не найдена');
  });

  it('студент → 403, удаление не вызывается', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/streams/s-1',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect(db.stream.delete).not.toHaveBeenCalled();
  });

  it('без токена → 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/streams/s-1' });

    expect(res.statusCode).toBe(401);
    expect(db.stream.delete).not.toHaveBeenCalled();
  });
});

// ─── Цена группы (платёжный план): валидация ──────────────────────────────────

describe('POST /streams — валидация priceKopecks', () => {
  it('400 — дробная цена', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', priceKopecks: 100.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — отрицательная цена', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', priceKopecks: -1 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — цена больше потолка MAX_AMOUNT_KOPECKS (переполнение Int4)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', priceKopecks: MAX_AMOUNT_KOPECKS + 1 },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('Цена слишком большая');
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('201 — цена ровно на потолке MAX_AMOUNT_KOPECKS допустима', async () => {
    db.stream.create.mockResolvedValueOnce({ id: 's-1', name: 'Группа', priceKopecks: MAX_AMOUNT_KOPECKS });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', priceKopecks: MAX_AMOUNT_KOPECKS },
    });
    expect(res.statusCode).toBe(201);
    expect(db.stream.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priceKopecks: MAX_AMOUNT_KOPECKS }) }),
    );
  });

  it('201 — цена null (план не задан) допустима', async () => {
    db.stream.create.mockResolvedValueOnce({ id: 's-1', name: 'Группа', priceKopecks: null });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', priceKopecks: null },
    });
    expect(res.statusCode).toBe(201);
    expect(db.stream.create).toHaveBeenCalled();
  });

  it('201 — цена 0 допустима, передаётся в create', async () => {
    db.stream.create.mockResolvedValueOnce({ id: 's-1', name: 'Группа', priceKopecks: 0 });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', priceKopecks: 0 },
    });
    expect(res.statusCode).toBe(201);
    expect(db.stream.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priceKopecks: 0 }) }),
    );
  });
});

describe('PATCH /streams/:id — меняет только цену, Charge не трогает', () => {
  it('400 — дробная цена', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1' });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { priceKopecks: 10.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.update).not.toHaveBeenCalled();
  });

  it('400 — цена больше потолка MAX_AMOUNT_KOPECKS (переполнение Int4)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1' });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { priceKopecks: MAX_AMOUNT_KOPECKS + 1 },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('Цена слишком большая');
    expect(db.stream.update).not.toHaveBeenCalled();
  });

  it('200 — цена null снимает план (валидно)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1' });
    db.stream.update.mockResolvedValueOnce({ id: 's-1', priceKopecks: null });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { priceKopecks: null },
    });
    expect(res.statusCode).toBe(200);
    expect(db.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priceKopecks: null }) }),
    );
  });

  it('200 — обновляет priceKopecks', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1' });
    db.stream.update.mockResolvedValueOnce({ id: 's-1', priceKopecks: 20000 });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { priceKopecks: 20000 },
    });
    expect(res.statusCode).toBe(200);
    expect(db.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priceKopecks: 20000 }) }),
    );
  });
});

// ─── GET /streams/:id/charges — статус оплаты учеников ─────────────────────────

describe('GET /streams/:id/charges', () => {
  it('403 — студент не имеет доступа к финансам группы', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/streams/s-1/charges',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
    expect(db.streamEnrollment.findMany).not.toHaveBeenCalled();
  });

  it('404 — группа не найдена', async () => {
    db.stream.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/streams/missing/charges',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('200 — статус оплаты по ученикам (paid/partial/unpaid/none)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', priceKopecks: 10000 });
    db.streamEnrollment.findMany.mockResolvedValueOnce([
      { user: { id: 'u-1', name: 'Оплатил', email: 'a@x', charges: [{ id: 'c-1', amountKopecks: 10000, paidKopecks: 10000, status: 'paid' }] } },
      { user: { id: 'u-2', name: 'Частично', email: 'b@x', charges: [{ id: 'c-2', amountKopecks: 10000, paidKopecks: 3000, status: 'open' }] } },
      { user: { id: 'u-3', name: 'Должник', email: 'c@x', charges: [{ id: 'c-3', amountKopecks: 10000, paidKopecks: 0, status: 'open' }] } },
      { user: { id: 'u-4', name: 'Без начисления', email: 'd@x', charges: [] } },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/streams/s-1/charges',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.priceKopecks).toBe(10000);
    expect(body.students.map((s: { paymentStatus: string }) => s.paymentStatus)).toEqual([
      'paid',
      'partial',
      'unpaid',
      'none',
    ]);
    expect(body.students[0]).toMatchObject({ id: 'u-1', paidKopecks: 10000 });
    expect(body.students[3]).toMatchObject({ id: 'u-4', amountKopecks: null, status: null });
  });

  it('200 — АГРЕГАТ долга по нескольким месячным начислениям (а не по последнему)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({
      id: 's-1',
      priceKopecks: null,
      billingType: 'monthly',
      monthlyPriceKopecks: 500000,
    });
    db.streamEnrollment.findMany.mockResolvedValueOnce([
      {
        // Два месячных начисления: апрель погашен, май открыт (долг 500000).
        user: {
          id: 'u-1',
          name: 'Должник по маю',
          email: 'a@x',
          charges: [
            { id: 'c-may', amountKopecks: 500000, paidKopecks: 0, status: 'open', kind: 'monthly', periodKey: '2026-05' },
            { id: 'c-apr', amountKopecks: 500000, paidKopecks: 500000, status: 'paid', kind: 'monthly', periodKey: '2026-04' },
          ],
        },
      },
      {
        // Оба периода погашены — долга нет.
        user: {
          id: 'u-2',
          name: 'Всё оплатил',
          email: 'b@x',
          charges: [
            { id: 'c2-may', amountKopecks: 500000, paidKopecks: 500000, status: 'paid', kind: 'monthly', periodKey: '2026-05' },
            { id: 'c2-apr', amountKopecks: 500000, paidKopecks: 500000, status: 'paid', kind: 'monthly', periodKey: '2026-04' },
          ],
        },
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/streams/s-1/charges',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.billingType).toBe('monthly');
    expect(body.monthlyPriceKopecks).toBe(500000);
    // u-1: долг = 500000 (только открытый май), оплачено суммарно 500000 → partial.
    expect(body.students[0]).toMatchObject({
      id: 'u-1',
      amountKopecks: 1000000, // сумма обоих начислений
      paidKopecks: 500000,
      outstandingKopecks: 500000,
      paymentStatus: 'partial',
    });
    // periods отданы для детализации (фронт отличает месячные по kind/periodKey).
    expect(body.students[0].periods).toHaveLength(2);
    expect(body.students[0].periods[0]).toMatchObject({ kind: 'monthly', periodKey: '2026-05' });
    // u-2: долга нет → paid, outstanding 0.
    expect(body.students[1]).toMatchObject({
      id: 'u-2',
      outstandingKopecks: 0,
      paymentStatus: 'paid',
    });
  });
});

// ─── Валидация плана биллинга (monthly) ───────────────────────────────────────

describe('POST /streams — валидация плана биллинга (monthly)', () => {
  it('400 — billingType вне enum', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', billingType: 'weekly' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — monthly без billingDayOfMonth', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', billingType: 'monthly', monthlyPriceKopecks: 500000 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — monthly без monthlyPriceKopecks', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', billingType: 'monthly', billingDayOfMonth: 15 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — billingDayOfMonth вне диапазона 1..28 (29)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', billingType: 'monthly', monthlyPriceKopecks: 500000, billingDayOfMonth: 29 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — billingDayOfMonth дробный', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', billingType: 'monthly', monthlyPriceKopecks: 500000, billingDayOfMonth: 15.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — monthlyPriceKopecks больше потолка', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', billingType: 'monthly', monthlyPriceKopecks: MAX_AMOUNT_KOPECKS + 1, billingDayOfMonth: 15 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('201 — валидная monthly-группа: поля биллинга уходят в create и возвращаются', async () => {
    db.stream.create.mockResolvedValueOnce({
      id: 's-1',
      name: 'Менторская',
      billingType: 'monthly',
      monthlyPriceKopecks: 500000,
      billingDayOfMonth: 15,
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Менторская', billingType: 'monthly', monthlyPriceKopecks: 500000, billingDayOfMonth: 15 },
    });
    expect(res.statusCode).toBe(201);
    expect(db.stream.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingType: 'monthly',
          monthlyPriceKopecks: 500000,
          billingDayOfMonth: 15,
        }),
      }),
    );
    expect(res.json().stream).toMatchObject({ billingType: 'monthly', billingDayOfMonth: 15 });
  });

  it('201 — день на границе (1 и 28) допустим', async () => {
    db.stream.create.mockResolvedValue({ id: 's-1' });
    const app = buildApp();
    for (const day of [1, 28]) {
      const res = await app.inject({
        method: 'POST',
        url: '/streams',
        headers: authHeaders(adminToken),
        payload: { name: 'Группа', billingType: 'monthly', monthlyPriceKopecks: 1, billingDayOfMonth: day },
      });
      expect(res.statusCode).toBe(201);
    }
  });
});

describe('PATCH /streams/:id — валидация плана биллинга (monthly)', () => {
  it('400 — переключение one_time→monthly без дня', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', billingType: 'one_time' });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { billingType: 'monthly', monthlyPriceKopecks: 500000 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.update).not.toHaveBeenCalled();
  });

  it('400 — у monthly-группы пытаются обнулить день (billingDayOfMonth=null)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', billingType: 'monthly' });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { billingDayOfMonth: null },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.update).not.toHaveBeenCalled();
  });

  it('200 — переключение на monthly с днём и суммой', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', billingType: 'one_time' });
    db.stream.update.mockResolvedValueOnce({ id: 's-1', billingType: 'monthly', billingDayOfMonth: 10 });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { billingType: 'monthly', monthlyPriceKopecks: 300000, billingDayOfMonth: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(db.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingType: 'monthly',
          monthlyPriceKopecks: 300000,
          billingDayOfMonth: 10,
        }),
      }),
    );
  });

  it('200 — обновление только дня у уже monthly-группы', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', billingType: 'monthly' });
    db.stream.update.mockResolvedValueOnce({ id: 's-1', billingDayOfMonth: 20 });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { billingDayOfMonth: 20 },
    });
    expect(res.statusCode).toBe(200);
    expect(db.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ billingDayOfMonth: 20 }) }),
    );
  });
});

// ─── Счётчик учеников без демо/служебных аккаунтов (User.isDemo) ───────────────

describe('GET /streams — studentsCount без демо', () => {
  it('200 — studentsCount берётся из filtered _count (enrollments where user.isDemo=false)', async () => {
    // Prisma уже вернёт _count.enrollments отфильтрованным; мы проверяем, что роут
    // (а) пробрасывает это число в studentsCount и (б) просит фильтр по не-демо.
    db.stream.findMany.mockResolvedValueOnce([
      {
        id: 's-1',
        name: 'Группа',
        status: 'active',
        ownerId: null,
        programId: null,
        priceKopecks: null,
        billingType: 'one_time',
        monthlyPriceKopecks: null,
        billingDayOfMonth: null,
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-01T00:00:00Z'),
        joinToken: 'secret-token',
        joinTokenAt: new Date('2026-05-01T00:00:00Z'),
        owner: null,
        program: null,
        sessions: [],
        // 3 не-демо ученика (демо-зачисления Prisma уже отфильтровала).
        _count: { enrollments: 3 },
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/streams',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.streams[0].studentsCount).toBe(3);
    // joinToken/joinTokenAt не светим в общем списке.
    expect(body.streams[0].joinToken).toBeUndefined();
    expect(body.streams[0].joinTokenAt).toBeUndefined();
    // Запрошен filtered relation-count по не-демо студентам.
    const includeArg = db.stream.findMany.mock.calls[0][0].include;
    expect(includeArg._count.select.enrollments).toEqual({
      where: { user: { isDemo: false } },
    });
  });
});

describe('GET /streams/:id — studentsCount без демо', () => {
  it('200 — детали группы считают учеников без демо/служебных', async () => {
    db.stream.findUnique.mockResolvedValueOnce({
      id: 's-1',
      name: 'Группа',
      status: 'active',
      ownerId: null,
      programId: null,
      priceKopecks: null,
      billingType: 'one_time',
      monthlyPriceKopecks: null,
      billingDayOfMonth: null,
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
      joinToken: 'secret-token',
      joinTokenAt: new Date('2026-05-01T00:00:00Z'),
      owner: null,
      program: null,
      sessions: [],
      _count: { enrollments: 2, sessions: 0 },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stream.studentsCount).toBe(2);
    // filtered relation-count по не-демо студентам.
    const includeArg = db.stream.findUnique.mock.calls[0][0].include;
    expect(includeArg._count.select.enrollments).toEqual({
      where: { user: { isDemo: false } },
    });
  });
});

describe('GET /streams/:id/students — ростер содержит демо с флагом isDemo', () => {
  it('200 — демо-ученик НЕ скрыт из списка и помечен isDemo=true', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1' });
    db.streamEnrollment.findMany.mockResolvedValueOnce([
      {
        user: {
          id: 'u-1',
          name: 'Обычный',
          email: 'a@x.ru',
          isActive: true,
          isDemo: false,
          createdAt: new Date('2026-05-01T00:00:00Z'),
        },
      },
      {
        user: {
          id: 'u-demo',
          name: 'Демо',
          email: 'demo@x.ru',
          isActive: true,
          isDemo: true,
          createdAt: new Date('2026-05-02T00:00:00Z'),
        },
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/streams/s-1/students',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Демо-ученик присутствует в ростере (НЕ скрыт): оба ученика на месте.
    expect(body.students).toHaveLength(2);
    expect(body.students.map((s: { id: string }) => s.id)).toEqual(['u-1', 'u-demo']);
    // Поле isDemo отдано для бейджа «Демо».
    expect(body.students[0].isDemo).toBe(false);
    expect(body.students[1].isDemo).toBe(true);
    // Ростер не фильтрует по isDemo (берёт всех не-удалённых).
    expect(db.streamEnrollment.findMany.mock.calls[0][0].where).toEqual({
      streamId: 's-1',
      user: { deletedAt: null },
    });
    // isDemo запрошен в select user.
    const selectArg = db.streamEnrollment.findMany.mock.calls[0][0].include.user.select;
    expect(selectArg.isDemo).toBe(true);
  });
});

describe('POST /streams — валидация paymentUrl (внешняя ссылка на оплату)', () => {
  it('400 — невалидный URL', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', paymentUrl: 'не-ссылка' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(
      'Ссылка на оплату должна быть корректным URL (http/https)',
    );
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('400 — не-http(s) протокол (ftp)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', paymentUrl: 'ftp://pay.example/x' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.stream.create).not.toHaveBeenCalled();
  });

  it('201 — валидный https URL сохраняется (trim)', async () => {
    db.stream.create.mockResolvedValueOnce({ id: 's-1', name: 'Группа', paymentUrl: 'https://pay.example/x' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', paymentUrl: '  https://pay.example/x  ' },
    });
    expect(res.statusCode).toBe(201);
    expect(db.stream.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentUrl: 'https://pay.example/x' }) }),
    );
  });

  it('201 — пустая строка → paymentUrl: null (очистка)', async () => {
    db.stream.create.mockResolvedValueOnce({ id: 's-1', name: 'Группа', paymentUrl: null });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа', paymentUrl: '   ' },
    });
    expect(res.statusCode).toBe(201);
    expect(db.stream.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentUrl: null }) }),
    );
  });

  it('201 — paymentUrl не передан → ключ не пишется в create', async () => {
    db.stream.create.mockResolvedValueOnce({ id: 's-1', name: 'Группа' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(adminToken),
      payload: { name: 'Группа' },
    });
    expect(res.statusCode).toBe(201);
    expect('paymentUrl' in db.stream.create.mock.calls[0][0].data).toBe(false);
  });

  it('403 — студент не может создавать группу', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams',
      headers: authHeaders(studentToken),
      payload: { name: 'Группа', paymentUrl: 'https://pay.example/x' },
    });
    expect(res.statusCode).toBe(403);
    expect(db.stream.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /streams/:id — валидация paymentUrl', () => {
  it('400 — невалидный URL', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', billingType: 'one_time' });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { paymentUrl: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(
      'Ссылка на оплату должна быть корректным URL (http/https)',
    );
    expect(db.stream.update).not.toHaveBeenCalled();
  });

  it('200 — пустая строка очищает ссылку (paymentUrl: null)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', billingType: 'one_time' });
    db.stream.update.mockResolvedValueOnce({ id: 's-1', paymentUrl: null });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { paymentUrl: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(db.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentUrl: null }) }),
    );
  });

  it('200 — валидный http URL сохраняется', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', billingType: 'one_time' });
    db.stream.update.mockResolvedValueOnce({ id: 's-1', paymentUrl: 'http://pay.example/y' });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/streams/s-1',
      headers: authHeaders(adminToken),
      payload: { paymentUrl: 'http://pay.example/y' },
    });
    expect(res.statusCode).toBe(200);
    expect(db.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentUrl: 'http://pay.example/y' }) }),
    );
  });
});
