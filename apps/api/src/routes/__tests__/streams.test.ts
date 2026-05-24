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
      },
    },
    Prisma: actual.Prisma,
  };
});

import { streamRoutes } from '../streams.js';
import { prisma, Prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

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
