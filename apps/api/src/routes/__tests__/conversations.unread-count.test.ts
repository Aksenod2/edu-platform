import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// DB-free тест GET /messages/unread-count: мокаем только те методы prisma, которые
// трогает хендлер. JWT-аутентификация (authenticate) для access-токена БД не дёргает,
// поэтому хватает валидного токена.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return {
    prisma: {
      conversation: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      conversationEntry: { count: vi.fn() },
      conversationRead: { findUnique: vi.fn(), findMany: vi.fn() },
      stream: { findMany: vi.fn() },
      streamEnrollment: { findMany: vi.fn() },
    },
    Prisma: actual.Prisma,
  };
});

// s3/notifications импортируются в conversations.ts на уровне модуля — заглушки,
// чтобы регистрация роутов прошла без побочных эффектов.
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}));
vi.mock('../../lib/notifications.js', () => ({
  notifyMany: vi.fn(() => Promise.resolve()),
}));

import { conversationRoutes } from '../conversations.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(conversationRoutes);
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

describe('GET /messages/unread-count', () => {
  it('401 без токена', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/messages/unread-count' });
    expect(res.statusCode).toBe(401);
  });

  describe('админ — сумма 3 каналов', () => {
    it('складывает личные треды + штаб + cohort-чаты', async () => {
      // (а) личные треды: один count входящих от студентов с readAt=null.
      // (б) штаб: getOrCreateStaffConversation -> findFirst, затем countUnread:
      //     conversationRead.findUnique + conversationEntry.count.
      // (в) cohort: stream.findMany -> два потока; conversation.findMany (cohort-каналы),
      //     conversationRead.findMany, по count'у на канал.
      db.conversationEntry.count
        // (а) личные треды
        .mockResolvedValueOnce(5)
        // (б) штаб (countUnread)
        .mockResolvedValueOnce(3)
        // (в) cohort-канал #1
        .mockResolvedValueOnce(2)
        // (в) cohort-канал #2
        .mockResolvedValueOnce(4);

      db.conversation.findFirst.mockResolvedValueOnce({ id: 'staff-conv', type: 'staff' });
      db.conversationRead.findUnique.mockResolvedValueOnce(null);
      db.stream.findMany.mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }]);
      db.conversation.findMany.mockResolvedValueOnce([{ id: 'co-1' }, { id: 'co-2' }]);
      db.conversationRead.findMany.mockResolvedValueOnce([]);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/messages/unread-count',
        headers: authHeaders(adminToken),
      });

      expect(res.statusCode).toBe(200);
      // 5 (личные) + 3 (штаб) + 2 + 4 (cohort) = 14.
      expect(res.json()).toEqual({ unreadCount: 14 });
    });

    it('личные треды считают только входящие от студентов, не прочитанные, не свои', async () => {
      db.conversationEntry.count.mockResolvedValue(0);
      db.conversation.findFirst.mockResolvedValueOnce({ id: 'staff-conv', type: 'staff' });
      db.conversationRead.findUnique.mockResolvedValueOnce(null);
      db.stream.findMany.mockResolvedValueOnce([]);

      const app = buildApp();
      await app.inject({
        method: 'GET',
        url: '/messages/unread-count',
        headers: authHeaders(adminToken),
      });

      // Первый count — личные треды: type='student', автор-студент, readAt=null, не сам.
      expect(db.conversationEntry.count).toHaveBeenCalledWith({
        where: {
          conversation: { type: 'student' },
          author: { role: 'student' },
          authorId: { not: 'admin-1' },
          readAt: null,
        },
      });
    });

    it('cohort=0, если у потоков ещё нет cohort-каналов', async () => {
      db.conversationEntry.count
        .mockResolvedValueOnce(1) // личные
        .mockResolvedValueOnce(0); // штаб
      db.conversation.findFirst.mockResolvedValueOnce({ id: 'staff-conv' });
      db.conversationRead.findUnique.mockResolvedValueOnce(null);
      db.stream.findMany.mockResolvedValueOnce([{ id: 's-1' }]);
      // Каналов cohort ещё нет -> short-circuit, count по записям не зовётся.
      db.conversation.findMany.mockResolvedValueOnce([]);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/messages/unread-count',
        headers: authHeaders(adminToken),
      });

      expect(res.json()).toEqual({ unreadCount: 1 });
      // conversationEntry.count вызван ровно дважды (личные + штаб), без cohort-count'ов.
      expect(db.conversationEntry.count).toHaveBeenCalledTimes(2);
    });
  });

  describe('студент — сумма 2 каналов, чужого не видит', () => {
    it('складывает свой личный тред + свои cohort-чаты', async () => {
      db.conversationEntry.count
        // (а) свой личный тред: входящие от admin/staff
        .mockResolvedValueOnce(2)
        // (б) cohort-канал студента
        .mockResolvedValueOnce(3);

      db.streamEnrollment.findMany.mockResolvedValueOnce([{ streamId: 's-1' }]);
      db.conversation.findMany.mockResolvedValueOnce([{ id: 'co-1' }]);
      db.conversationRead.findMany.mockResolvedValueOnce([]);

      const app = buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/messages/unread-count',
        headers: authHeaders(studentToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ unreadCount: 5 });
    });

    it('личный тред фильтруется по studentId=me (только свой) и автору не-студенту', async () => {
      db.conversationEntry.count.mockResolvedValue(0);
      db.streamEnrollment.findMany.mockResolvedValueOnce([]);

      const app = buildApp();
      await app.inject({
        method: 'GET',
        url: '/messages/unread-count',
        headers: authHeaders(studentToken),
      });

      expect(db.conversationEntry.count).toHaveBeenCalledWith({
        where: {
          conversation: { type: 'student', studentId: 'stu-1' },
          author: { role: { not: 'student' } },
          authorId: { not: 'stu-1' },
          readAt: null,
        },
      });
    });

    it('НЕ обращается к штаб-каналу и не перечисляет все потоки (приватность)', async () => {
      db.conversationEntry.count.mockResolvedValue(0);
      db.streamEnrollment.findMany.mockResolvedValueOnce([]);

      const app = buildApp();
      await app.inject({
        method: 'GET',
        url: '/messages/unread-count',
        headers: authHeaders(studentToken),
      });

      // Штаб создаётся только для админа.
      expect(db.conversation.findFirst).not.toHaveBeenCalled();
      // Студент НЕ запрашивает все потоки — только свои enrollments.
      expect(db.stream.findMany).not.toHaveBeenCalled();
      expect(db.streamEnrollment.findMany).toHaveBeenCalledWith({
        where: { userId: 'stu-1' },
        select: { streamId: true },
      });
    });

    it('cohort-каналы выбираются только по потокам студента (его enrollments)', async () => {
      db.conversationEntry.count.mockResolvedValue(0);
      db.streamEnrollment.findMany.mockResolvedValueOnce([
        { streamId: 's-1' },
        { streamId: 's-2' },
      ]);
      db.conversation.findMany.mockResolvedValueOnce([]);

      const app = buildApp();
      await app.inject({
        method: 'GET',
        url: '/messages/unread-count',
        headers: authHeaders(studentToken),
      });

      expect(db.conversation.findMany).toHaveBeenCalledWith({
        where: { type: 'cohort', streamId: { in: ['s-1', 's-2'] } },
        select: { id: true },
      });
    });
  });

  it('не помечает прочитанным: только count, без update/updateMany/upsert', async () => {
    // Ни одного метода записи прочтения в мок-наборе нет, поэтому достаточно
    // убедиться, что хендлер отрабатывает на чистых count/findMany. Если бы код
    // дёрнул updateMany/upsert — тест упал бы на отсутствующем методе мока.
    db.conversationEntry.count.mockResolvedValue(0);
    db.streamEnrollment.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/messages/unread-count',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(200);
  });
});
