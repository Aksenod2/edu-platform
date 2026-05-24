import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';
process.env.CORS_ORIGIN = 'https://example.test';

// Мокаем prisma (DB-free): только методы, которые трогают тестируемые ветки.
// Prisma реэкспортируем настоящий — нужен для `err instanceof Prisma.*`.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  const tx = {
    user: { create: vi.fn() },
    streamEnrollment: { create: vi.fn() },
    session: { findMany: vi.fn() },
    studentAssignment: { createMany: vi.fn() },
  };
  return {
    prisma: {
      stream: { findUnique: vi.fn(), update: vi.fn() },
      refreshToken: { create: vi.fn() },
      // $transaction(callback) выполняет колбэк с tx-клиентом.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn((cb: any) => cb(tx)),
      __tx: tx,
    },
    Prisma: actual.Prisma,
  };
});

// S3 — no-op (issueSession строит подписанный avatarUrl).
vi.mock('../../lib/s3.js', () => ({
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}));

// bcrypt — детерминированный хэш (не считаем реальный bcrypt в тестах).
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('hashed-pw')),
    compare: vi.fn(() => Promise.resolve(true)),
  },
}));

import { streamRoutes } from '../streams.js';
import { streamsPublicRoutes } from '../streams-public.js';
import { prisma, Prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const tx = db.__tx;

function buildAdminApp(): FastifyInstance {
  const app = Fastify();
  app.register(cookie);
  app.register(streamRoutes);
  return app;
}

function buildPublicApp(): FastifyInstance {
  const app = Fastify();
  app.register(cookie);
  app.register(streamsPublicRoutes);
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

// ─── Админские эндпоинты join-link ────────────────────────────────

describe('POST /streams/:id/join-link — получение/генерация ссылки', () => {
  it('генерирует токен, если его нет (идемпотентность: сохраняет в БД)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', joinToken: null });
    db.stream.update.mockResolvedValueOnce({ id: 's-1' });

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams/s-1/join-link',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; joinUrl: string };
    expect(body.token).toBeTruthy();
    expect(body.joinUrl).toBe(`https://example.test/join/${body.token}`);
    // Токен записан в БД с joinTokenAt.
    expect(db.stream.update).toHaveBeenCalledTimes(1);
    const updateArg = db.stream.update.mock.calls[0][0];
    expect(updateArg.data.joinToken).toBe(body.token);
    expect(updateArg.data.joinTokenAt).toBeInstanceOf(Date);
  });

  it('возвращает существующий токен без перегенерации (идемпотентно)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', joinToken: 'existing-token' });

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams/s-1/join-link',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; joinUrl: string };
    expect(body.token).toBe('existing-token');
    expect(body.joinUrl).toBe('https://example.test/join/existing-token');
    // НЕ перезаписываем существующий токен.
    expect(db.stream.update).not.toHaveBeenCalled();
  });

  it('несуществующий поток → 404', async () => {
    db.stream.findUnique.mockResolvedValueOnce(null);

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams/missing/join-link',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('студент → 403', async () => {
    const app = buildAdminApp();
    const res = await app.inject({
      method: 'POST',
      url: '/streams/s-1/join-link',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
    expect(db.stream.findUnique).not.toHaveBeenCalled();
  });

  it('без токена → 401', async () => {
    const app = buildAdminApp();
    const res = await app.inject({ method: 'POST', url: '/streams/s-1/join-link' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /streams/:id/join-link — перевыпуск ссылки', () => {
  it('генерирует НОВЫЙ токен (старый инвалидируется)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1' });
    db.stream.update.mockResolvedValueOnce({ id: 's-1' });

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/streams/s-1/join-link',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; joinUrl: string };
    expect(body.token).toBeTruthy();
    expect(body.joinUrl).toBe(`https://example.test/join/${body.token}`);
    // Записан новый токен (старый затёрт) с joinTokenAt.
    const updateArg = db.stream.update.mock.calls[0][0];
    expect(updateArg.data.joinToken).toBe(body.token);
    expect(updateArg.data.joinTokenAt).toBeInstanceOf(Date);
  });

  it('два последовательных перевыпуска дают РАЗНЫЕ токены', async () => {
    db.stream.findUnique.mockResolvedValue({ id: 's-1' });
    db.stream.update.mockResolvedValue({ id: 's-1' });

    const app = buildAdminApp();
    const res1 = await app.inject({
      method: 'DELETE',
      url: '/streams/s-1/join-link',
      headers: authHeaders(adminToken),
    });
    const res2 = await app.inject({
      method: 'DELETE',
      url: '/streams/s-1/join-link',
      headers: authHeaders(adminToken),
    });

    const t1 = (res1.json() as { token: string }).token;
    const t2 = (res2.json() as { token: string }).token;
    expect(t1).not.toBe(t2);
  });

  it('несуществующий поток → 404', async () => {
    db.stream.findUnique.mockResolvedValueOnce(null);

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/streams/missing/join-link',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('студент → 403', async () => {
    const app = buildAdminApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/streams/s-1/join-link',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Публичный GET ────────────────────────────────────────────────

describe('GET /public/streams/join/:token — превью потока', () => {
  it('валидный токен активного потока → имя + closed=false', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ name: 'Поток А', status: 'active' });

    const app = buildPublicApp();
    const res = await app.inject({ method: 'GET', url: '/public/streams/join/tok-1' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stream: { name: 'Поток А', closed: false } });
  });

  it('архивный поток → closed=true', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ name: 'Поток Б', status: 'archived' });

    const app = buildPublicApp();
    const res = await app.inject({ method: 'GET', url: '/public/streams/join/tok-2' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stream: { name: 'Поток Б', closed: true } });
  });

  it('невалидный токен → 404 «Ссылка недействительна»', async () => {
    db.stream.findUnique.mockResolvedValueOnce(null);

    const app = buildPublicApp();
    const res = await app.inject({ method: 'GET', url: '/public/streams/join/nope' });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('Ссылка недействительна');
  });
});

// ─── Публичный POST (регистрация + зачисление + сессия) ───────────

describe('POST /public/streams/join/:token — регистрация по ссылке', () => {
  const validBody = { email: 'New@Example.com', name: 'Новичок', password: 'secret123' };

  it('создаёт студента, зачисляет (с бэкофиллом задания) и выдаёт сессию (201)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', status: 'active' });
    tx.user.create.mockResolvedValueOnce({
      id: 'u-new',
      email: 'new@example.com',
      name: 'Новичок',
      role: 'student',
      mustChangePassword: false,
      avatarKey: null,
    });
    tx.streamEnrollment.create.mockResolvedValueOnce({ id: 'enr-1' });
    // Бэкофилл: одна сессия потока с заданием.
    tx.session.findMany.mockResolvedValueOnce([{ id: 'sess-1' }]);
    tx.studentAssignment.createMany.mockResolvedValueOnce({ count: 1 });
    db.refreshToken.create.mockResolvedValueOnce({ id: 'rt-1' });

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { accessToken: string; user: { id: string; role: string } };
    expect(body.accessToken).toBeTruthy();
    expect(body.user).toMatchObject({ id: 'u-new', role: 'student' });

    // Пользователь создан с нормализованным email и ролью student.
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    const userArg = tx.user.create.mock.calls[0][0];
    expect(userArg.data.email).toBe('new@example.com');
    expect(userArg.data.role).toBe('student');
    expect(userArg.data.passwordHash).toBe('hashed-pw');

    // Зачисление + бэкофилл задания по сессии потока.
    expect(tx.streamEnrollment.create).toHaveBeenCalledWith({
      data: { streamId: 's-1', userId: 'u-new' },
    });
    expect(tx.studentAssignment.createMany).toHaveBeenCalledTimes(1);
    const saArg = tx.studentAssignment.createMany.mock.calls[0][0];
    expect(saArg.data).toEqual([
      { sessionId: 'sess-1', studentId: 'u-new', status: 'assigned' },
    ]);

    // Refresh-cookie выставлен.
    const setCookie = res.headers['set-cookie'];
    expect(String(setCookie)).toContain('refreshToken=');
  });

  it('email уже занят (P2002) → 409 нейтрально', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', status: 'active' });
    tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe(
      'Аккаунт с таким email уже существует — войдите',
    );
    // Сессию НЕ выдаём.
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('архивный поток → 409 «Набор в этот поток закрыт» (user не создаётся)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', status: 'archived' });

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: validBody,
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('Набор в эту группу закрыт');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('невалидный токен → 404', async () => {
    db.stream.findUnique.mockResolvedValueOnce(null);

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/nope',
      payload: validBody,
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('Ссылка недействительна');
  });

  it('некорректный email → 400 (поток не запрашивается)', async () => {
    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: { email: 'not-an-email', name: 'X', password: 'secret123' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.stream.findUnique).not.toHaveBeenCalled();
  });

  it('короткий пароль → 400', async () => {
    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: { email: 'a@b.com', name: 'X', password: '123' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('пустое тело → 400', async () => {
    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
