// Блокировка зарубежной почты в АДМИНСКИХ точках назначения email (issue #132,
// ст. 10.7 149-ФЗ): POST /users (создание студента) и PATCH /users/:id (смена
// email). Существующие пользователи с зарубежной почтой продолжают работать —
// блокируется только назначение НОВОГО зарубежного адреса.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// DB-free: мокаем prisma (методы, которые трогают тестируемые ветки).
vi.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
  },
}));

// Почта/S3 — no-op (импортируются роутом users.ts).
vi.mock('../../lib/email.js', () => ({ sendInviteEmail: vi.fn() }));
vi.mock('../../lib/s3.js', () => ({ getFileUrl: vi.fn() }));

// bcrypt — детерминированный (POST /users хэширует временный пароль).
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('hashed-pw')),
    compare: vi.fn(() => Promise.resolve(true)),
  },
}));

import { userRoutes } from '../users.js';
import { prisma } from '@platform/db';
import { FOREIGN_EMAIL_ADMIN_MESSAGE } from '@platform/shared';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(userRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });

function authHeaders() {
  return { authorization: `Bearer ${adminToken}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /users — создание студента админом: зарубежная почта запрещена', () => {
  it('зарубежная почта (gmail, с регистром/пробелами) → 400 с админским сообщением', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: authHeaders(),
      payload: { email: '  New@GMail.com ', name: 'Студент' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(FOREIGN_EMAIL_ADMIN_MESSAGE);
    // До БД не дошли: ни проверки уникальности, ни создания.
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('российская почта (mail.ru) → 201, студент создан', async () => {
    db.user.findUnique.mockResolvedValueOnce(null); // email свободен
    db.user.create.mockResolvedValueOnce({
      id: 'u-1',
      email: 'new@mail.ru',
      name: 'Студент',
      lastName: null,
      phone: null,
      role: 'student',
      isActive: true,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: authHeaders(),
      payload: { email: 'New@Mail.ru', name: 'Студент' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.user.create.mock.calls[0][0].data.email).toBe('new@mail.ru');
  });
});

describe('PATCH /users/:id — смена email админом: зарубежная почта запрещена', () => {
  it('смена на зарубежный (icloud) → 400 с админским сообщением, update не вызван', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'u-1', email: 'old@mail.ru' });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(),
      payload: { email: 'student@icloud.com' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(FOREIGN_EMAIL_ADMIN_MESSAGE);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('смена на российский (yandex.ru) → 200', async () => {
    db.user.findUnique
      .mockResolvedValueOnce({ id: 'u-1', email: 'old@mail.ru' }) // existing
      .mockResolvedValueOnce(null); // новый email свободен
    db.user.update.mockResolvedValueOnce({ id: 'u-1', email: 'new@yandex.ru' });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(),
      payload: { email: 'New@Yandex.ru' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.update.mock.calls[0][0].data.email).toBe('new@yandex.ru');
  });

  it('email НЕ меняется (тот же зарубежный, что уже стоит) → правка остальных полей не блокируется', async () => {
    // Легаси-аккаунт на gmail: смена имени с тем же email в payload должна пройти.
    db.user.findUnique.mockResolvedValueOnce({ id: 'u-1', email: 'legacy@gmail.com' });
    db.user.update.mockResolvedValueOnce({ id: 'u-1', email: 'legacy@gmail.com', name: 'Новое имя' });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/u-1',
      headers: authHeaders(),
      payload: { email: 'legacy@gmail.com', name: 'Новое имя' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });
});
