// Блокировка зарубежной почты при САМОСТОЯТЕЛЬНОЙ смене email через
// PATCH /users/me (issue #132, ст. 10.7 149-ФЗ). Вход/refresh/forgot-password
// НЕ трогаем — существующие аккаунты на зарубежной почте продолжают работать,
// блокируется только назначение НОВОГО зарубежного адреса.
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
    hash: vi.fn(() => Promise.resolve('hashed-pw')),
    compare: vi.fn(() => Promise.resolve(true)),
  },
}));

// issueSession — сентинел (PATCH /users/me его не зовёт, но auth.ts импортирует).
vi.mock('../../lib/auth-session.js', () => ({
  issueSession: vi.fn(() => Promise.resolve({ user: { id: 'u1' }, accessToken: 't' })),
}));

// Почта — no-op.
vi.mock('../../lib/email.js', () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
}));

import { authRoutes } from '../auth.js';
import { prisma } from '@platform/db';
import { FOREIGN_EMAIL_STUDENT_MESSAGE } from '@platform/shared';
import { signAccessToken } from '../../lib/jwt.js';

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
  deletedAt: null,
};

const token = signAccessToken({ userId: 'u1', role: 'student' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /users/me — смена email: зарубежная почта запрещена', () => {
  it('смена на зарубежный (gmail, с регистром/пробелами) → 400 с сообщением для студента', async () => {
    db.user.findUnique.mockResolvedValueOnce(user);

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: '  Student@GMail.com ' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(FOREIGN_EMAIL_STUDENT_MESSAGE);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('смена на российский (yandex.ru) → 200, email обновлён', async () => {
    db.user.findUnique
      .mockResolvedValueOnce(user) // текущий пользователь
      .mockResolvedValueOnce(null); // новый email свободен
    db.user.update.mockResolvedValueOnce({
      id: 'u1',
      email: 'new@yandex.ru',
      name: 'Студент',
      lastName: null,
      phone: null,
      role: 'student',
      isActive: true,
      mustChangePassword: false,
      avatarKey: null,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'New@Yandex.ru' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.update.mock.calls[0][0].data.email).toBe('new@yandex.ru');
  });

  it('email не меняется (тот же зарубежный, что уже стоит) → правка имени проходит', async () => {
    // Легаси-аккаунт на gmail продолжает работать: блокируем только НОВЫЙ адрес.
    const legacy = { ...user, email: 'legacy@gmail.com' };
    db.user.findUnique.mockResolvedValueOnce(legacy);
    db.user.update.mockResolvedValueOnce({
      id: 'u1',
      email: 'legacy@gmail.com',
      name: 'Новое имя',
      lastName: null,
      phone: null,
      role: 'student',
      isActive: true,
      mustChangePassword: false,
      avatarKey: null,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'legacy@gmail.com', name: 'Новое имя' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });
});
