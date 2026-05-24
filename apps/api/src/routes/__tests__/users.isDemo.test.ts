import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// DB-free: мокаем prisma (методы, которые трогает PATCH /users/:id). Email/инвайты
// здесь не тестируем — только сохранение флага isDemo (демо/служебный аккаунт).
vi.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
  },
}));

// Email-модуль импортируется роутом users.ts — мокаем, чтобы не дёргать SMTP.
vi.mock('../../lib/email.js', () => ({ sendInviteEmail: vi.fn() }));
vi.mock('../../lib/s3.js', () => ({ getFileUrl: vi.fn() }));

import { userRoutes } from '../users.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(userRoutes);
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

describe('PATCH /users/:id — isDemo (admin)', () => {
  it('200 — сохраняет isDemo=true', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'u-1', email: 'a@x' });
    db.user.update.mockResolvedValueOnce({ id: 'u-1', isDemo: true });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(adminToken),
      payload: { isDemo: true },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDemo: true }) }),
    );
    expect(res.json().user).toMatchObject({ isDemo: true });
  });

  it('200 — сохраняет isDemo=false', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'u-1', email: 'a@x' });
    db.user.update.mockResolvedValueOnce({ id: 'u-1', isDemo: false });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(adminToken),
      payload: { isDemo: false },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDemo: false }) }),
    );
  });

  it('400 — isDemo не булево', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'u-1', email: 'a@x' });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(adminToken),
      payload: { isDemo: 'yes' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('403 — студент не может менять isDemo', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(studentToken),
      payload: { isDemo: true },
    });

    expect(res.statusCode).toBe(403);
  });

  it('isDemo не передан → поле не пишется (data без isDemo)', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'u-1', email: 'a@x' });
    db.user.update.mockResolvedValueOnce({ id: 'u-1', name: 'Новое имя' });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(adminToken),
      payload: { name: 'Новое имя' },
    });

    expect(res.statusCode).toBe(200);
    const dataArg = db.user.update.mock.calls[0][0].data;
    expect('isDemo' in dataArg).toBe(false);
  });
});

describe('GET /users — список студентов содержит демо с флагом isDemo', () => {
  it('200 — демо-студент НЕ скрыт из списка и помечен isDemo=true', async () => {
    db.user.findMany.mockResolvedValueOnce([
      {
        id: 'u-1',
        email: 'a@x',
        name: 'Обычный',
        role: 'student',
        isActive: true,
        isDemo: false,
        balanceKopecks: 0,
        createdAt: new Date('2026-05-01T00:00:00Z'),
        inviteToken: null,
        inviteExpiresAt: null,
        deletedAt: null,
        _count: { studentAssignments: 0 },
      },
      {
        id: 'u-demo',
        email: 'demo@x',
        name: 'Демо',
        role: 'student',
        isActive: true,
        isDemo: true,
        balanceKopecks: 0,
        createdAt: new Date('2026-05-02T00:00:00Z'),
        inviteToken: null,
        inviteExpiresAt: null,
        deletedAt: null,
        _count: { studentAssignments: 0 },
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Демо-студент остаётся в списке (админ им управляет).
    expect(body.users).toHaveLength(2);
    expect(body.users[1]).toMatchObject({ id: 'u-demo', isDemo: true });
    expect(body.users[0]).toMatchObject({ id: 'u-1', isDemo: false });
    // isDemo запрошен в select.
    expect(db.user.findMany.mock.calls[0][0].select.isDemo).toBe(true);
  });
});
