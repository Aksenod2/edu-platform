import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Deterministic secret before jwt.ts reads it on import.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Mock the Prisma client so the API-key auth path is controllable without a DB.
vi.mock('@platform/db', () => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      // Fire-and-forget lastUsedAt update in the middleware: must return a thenable.
      update: vi.fn(() => Promise.resolve({})),
    },
  },
}));

import { prisma } from '@platform/db';
import { authenticate, requireRole } from '../auth.js';
import { signAccessToken } from '../../lib/jwt.js';

const findUnique = vi.mocked(prisma.apiKey.findUnique);

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.get('/admin-only', { preHandler: requireRole('admin') }, async () => ({ ok: true }));
  app.get('/authed', { preHandler: authenticate }, async (request) => ({ user: request.user }));
  return app;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authenticate / requireRole — JWT', () => {
  it('без заголовка Authorization → 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Токен не предоставлен' });
  });

  it('битый токен → 401', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: bearer('not-a-real-token'),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Невалидный или просроченный токен' });
  });

  it('валидный admin-токен → доступ к admin-only', async () => {
    const app = buildApp();
    const token = signAccessToken({ userId: 'u-admin', role: 'admin' });
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('валидный student-токен на admin-only → 403', async () => {
    const app = buildApp();
    const token = signAccessToken({ userId: 'u-student', role: 'student' });
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'Недостаточно прав' });
  });

  it('authenticate проставляет request.user из токена', async () => {
    const app = buildApp();
    const token = signAccessToken({ userId: 'u-42', role: 'student' });
    const res = await app.inject({ method: 'GET', url: '/authed', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ userId: 'u-42', role: 'student' });
    // JWT-путь не должен трогать БД.
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('authenticate / requireRole — API-ключ (sk_)', () => {
  it('активный admin-ключ → доступ; lastUsedAt обновляется', async () => {
    findUnique.mockResolvedValue({
      id: 'k1',
      revokedAt: null,
      user: { id: 'u1', role: 'admin', isActive: true, deletedAt: null },
    } as never);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: bearer('sk_live_x') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(prisma.apiKey.update).toHaveBeenCalledTimes(1);
  });

  it('отозванный ключ → 401', async () => {
    findUnique.mockResolvedValue({
      id: 'k1',
      revokedAt: new Date(),
      user: { id: 'u1', role: 'admin', isActive: true, deletedAt: null },
    } as never);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: bearer('sk_live_x') });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Невалидный или отозванный API-ключ' });
  });

  it('несуществующий ключ → 401', async () => {
    findUnique.mockResolvedValue(null as never);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: bearer('sk_live_x') });
    expect(res.statusCode).toBe(401);
  });

  it('неактивный пользователь ключа → 401', async () => {
    findUnique.mockResolvedValue({
      id: 'k1',
      revokedAt: null,
      user: { id: 'u1', role: 'admin', isActive: false, deletedAt: null },
    } as never);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: bearer('sk_live_x') });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Пользователь неактивен' });
  });

  it('ключ student-пользователя на admin-only → 403', async () => {
    findUnique.mockResolvedValue({
      id: 'k1',
      revokedAt: null,
      user: { id: 'u1', role: 'student', isActive: true, deletedAt: null },
    } as never);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin-only', headers: bearer('sk_live_x') });
    expect(res.statusCode).toBe(403);
  });
});
