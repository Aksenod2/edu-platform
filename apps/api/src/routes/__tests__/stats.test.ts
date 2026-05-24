import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогает GET /stats (DB-free). Все
// студенческие агрегаты должны исключать демо/служебные аккаунты (User.isDemo).
vi.mock('@platform/db', () => ({
  prisma: {
    user: { count: vi.fn(), findMany: vi.fn() },
    stream: { count: vi.fn() },
    studentAssignment: { groupBy: vi.fn(), findMany: vi.fn() },
    session: { count: vi.fn(), findMany: vi.fn() },
    conversation: { findMany: vi.fn() },
  },
  Prisma: {},
}));

import { statsRoutes } from '../stats.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(statsRoutes);
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

describe('GET /stats — метрики студентов без демо/служебных аккаунтов', () => {
  it('200 — все count/findMany по студентам фильтруют isDemo=false', async () => {
    // Числа произвольны: проверяем не значения, а ФИЛЬТР запросов.
    db.user.count.mockResolvedValue(0);
    db.user.findMany.mockResolvedValue([]);
    db.stream.count.mockResolvedValue(0);
    db.studentAssignment.groupBy.mockResolvedValue([]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    db.session.count.mockResolvedValue(0);
    db.session.findMany.mockResolvedValue([]);
    db.conversation.findMany.mockResolvedValue([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/stats',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);

    // Каждый вызов user.count — про студентов, значит должен нести isDemo=false.
    expect(db.user.count).toHaveBeenCalled();
    for (const call of db.user.count.mock.calls) {
      expect(call[0].where).toMatchObject({ role: 'student', deletedAt: null, isDemo: false });
    }
    // Списки студентов (attention.onboarding) — тоже без демо.
    const onboardingCall = db.user.findMany.mock.calls.find(
      (c: [{ where?: { role?: string } }]) => c[0]?.where?.role === 'student',
    );
    expect(onboardingCall).toBeDefined();
    expect(onboardingCall[0].where).toMatchObject({ isDemo: false, deletedAt: null });

    // Неотвеченные треды (attention.unansweredThreads) — student без демо.
    expect(db.conversation.findMany).toHaveBeenCalled();
    const convoWhere = db.conversation.findMany.mock.calls[0][0].where;
    expect(convoWhere.student).toMatchObject({ deletedAt: null, isDemo: false });
  });

  it('требует роль admin: студент → 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/stats',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
    expect(db.user.count).not.toHaveBeenCalled();
  });

  it('требует аутентификацию: без токена → 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/stats' });
    expect(res.statusCode).toBe(401);
    expect(db.user.count).not.toHaveBeenCalled();
  });
});
