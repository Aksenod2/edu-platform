// Регрессионные тесты на прод-баг «вход не работает из-за регистра email»:
// планшет при регистрации делал первую букву заглавной, а /auth/login и
// /auth/forgot-password искали точное совпадение. Проверяем, что ввод
// пользователя нормализуется (trim + lowercase) перед поиском в БД и что
// forgot-password отвечает сразу, не дожидаясь отправки письма (fire-and-forget).
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

// issueSession — сентинел вместо реальной выдачи токенов/cookie.
vi.mock('../../lib/auth-session.js', () => ({
  issueSession: vi.fn(() => Promise.resolve({ user: { id: 'u1' }, accessToken: 't' })),
}));

// Почта — управляемый мок: проверяем, что ответ не ждёт отправки письма.
vi.mock('../../lib/email.js', () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
}));

import { authRoutes } from '../auth.js';
import { prisma } from '@platform/db';
import { sendPasswordResetEmail } from '../../lib/email.js';
import { normalizeEmail } from '../../lib/validation.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const activeUser = {
  id: 'u1',
  email: 'marina@mail.ru',
  passwordHash: 'hashed-pw',
  role: 'student',
  isActive: true,
  studentProfile: null,
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeEmail', () => {
  it('срезает пробелы и приводит к нижнему регистру', () => {
    expect(normalizeEmail('  Marina@Mail.RU ')).toBe('marina@mail.ru');
  });
});

describe('POST /auth/login — регистр и пробелы в email не мешают входу', () => {
  it('ищет пользователя по нормализованному email', async () => {
    const app = await buildApp();
    db.user.findUnique.mockResolvedValue(activeUser);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: '  Marina@Mail.RU ', password: 'secret123' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'marina@mail.ru' } }),
    );
  });
});

describe('POST /auth/forgot-password — нормализация и быстрый ответ', () => {
  it('ищет по нормализованному email и шлёт письмо на хранимый адрес', async () => {
    const app = await buildApp();
    db.user.findUnique.mockResolvedValue(activeUser);
    db.user.update.mockResolvedValue(activeUser);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: ' MARINA@mail.ru ' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'marina@mail.ru' } });
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('marina@mail.ru', expect.any(String));
  });

  it('отвечает успехом сразу, даже если отправка письма падает (fire-and-forget)', async () => {
    const app = await buildApp();
    db.user.findUnique.mockResolvedValue(activeUser);
    db.user.update.mockResolvedValue(activeUser);
    vi.mocked(sendPasswordResetEmail).mockRejectedValue(new Error('SMTP down'));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'marina@mail.ru' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      message: 'Если аккаунт существует, письмо со ссылкой отправлено',
    });
  });
});
