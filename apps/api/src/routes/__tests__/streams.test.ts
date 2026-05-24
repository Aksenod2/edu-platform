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
});
