// Регрессионные тесты на фикс безопасности: POST /auth/change-password менял
// пароль БЕЗ отзыва refresh-токенов (в reset-password и PATCH /users/me отзыв
// был). Проверяем, что после смены пароля все refresh-токены пользователя
// удаляются, а текущая сессия получает новый accessToken (поведение фронта
// /change-password сохранено).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma (DB-free): только методы, которые трогают тестируемые ветки.
vi.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
  },
}));

// S3 — no-op (auth.ts импортирует uploadFile/getFileUrl для аватаров).
vi.mock('../../lib/s3.js', () => ({
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}));

// bcrypt — детерминированный (не считаем реальный bcrypt в тестах).
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('new-hashed-pw')),
    compare: vi.fn(() => Promise.resolve(true)),
  },
}));

// issueSession — сентинел (change-password его не зовёт, но auth.ts импортирует).
vi.mock('../../lib/auth-session.js', () => ({
  issueSession: vi.fn(() => Promise.resolve({ user: { id: 'u1' }, accessToken: 't' })),
}));

// Почта — no-op.
vi.mock('../../lib/email.js', () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
}));

import bcrypt from 'bcryptjs';
import { authRoutes } from '../auth.js';
import { prisma } from '@platform/db';
import { signAccessToken, verifyAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authRoutes);
  return app;
}

const user = {
  id: 'u1',
  email: 'student@mail.ru',
  passwordHash: 'old-hashed-pw',
  role: 'student',
  isActive: true,
};

const token = signAccessToken({ userId: 'u1', role: 'student' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/change-password — отзыв refresh-токенов', () => {
  it('после смены пароля удаляет все refresh-токены пользователя и выдаёт новый accessToken', async () => {
    db.user.findUnique.mockResolvedValue(user);
    db.user.update.mockResolvedValue({ ...user, passwordHash: 'new-hashed-pw' });
    db.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'old-secret', newPassword: 'new-secret' },
    });

    expect(res.statusCode).toBe(200);

    // Все refresh-токены пользователя отозваны (чужие сессии разлогинены).
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });

    // Текущая сессия получает рабочий новый accessToken (контракт фронта
    // /change-password: setAccessToken(result.accessToken)).
    const body = res.json() as { accessToken: string; message: string };
    expect(body.accessToken).toBeTruthy();
    const payload = verifyAccessToken(body.accessToken);
    expect(payload.userId).toBe('u1');
    expect(payload.role).toBe('student');
  });

  it('при неверном текущем пароле → 401 и refresh-токены НЕ отзываются', async () => {
    db.user.findUnique.mockResolvedValue(user);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'wrong', newPassword: 'new-secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('без токена → 401', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: 'old', newPassword: 'new-secret' },
    });

    expect(res.statusCode).toBe(401);
    expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
  });
});
