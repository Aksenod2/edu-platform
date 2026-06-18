import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Страж контракта матрицы уведомлений (issue #172): фронт шлёт category-форму
// { preferences: [{ category, channelEmail, channelPush }] }, бэк раскрывает категорию
// в per-type записи. DB-free: мокаем prisma.
//
// ВАЖНО: app поднимается как в проде — голый Fastify(), БЕЗ setSerializerCompiler /
// setValidatorCompiler (инцидент 2026-06-18: глобальный zod-сериализатор сломал
// ответы всех роутов → 500). Тест бы это поймал.
vi.mock('@platform/db', () => ({
  prisma: {
    notification: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
    notificationPreference: { findMany: vi.fn(() => Promise.resolve([])), upsert: vi.fn() },
  },
}));

import { notificationRoutes } from '../notifications.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(notificationRoutes);
  return app;
}

const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.notificationPreference.findMany.mockResolvedValue([]);
  db.notificationPreference.upsert.mockResolvedValue({});
});

describe('PATCH /notification-preferences (category-форма фронта, #172)', () => {
  it('401 без токена', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      payload: { preferences: [{ category: 'feedback', channelPush: true, channelEmail: false }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('реальное тело фронт-формы → 200 + per-type upsert по типам категории', async () => {
    db.notificationPreference.upsert.mockResolvedValue({});
    db.notificationPreference.findMany.mockResolvedValue([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      // именно то, что шлёт updateNotificationPreferences в apps/web/src/lib/api.ts
      payload: { preferences: [{ category: 'feedback', channelEmail: false, channelPush: true }] },
    });

    expect(res.statusCode).toBe(200);

    // feedback → thread_entry + assignment_reviewed: два upsert, оба по userId_type
    // текущего пользователя, флаги каналов записаны во все типы категории.
    expect(db.notificationPreference.upsert).toHaveBeenCalledTimes(2);
    const calls = db.notificationPreference.upsert.mock.calls.map((c: unknown[]) => c[0]);
    const upsertedTypes = calls.map((c: { where: { userId_type: { type: string } } }) => c.where.userId_type.type);
    expect(upsertedTypes.sort()).toEqual(['assignment_reviewed', 'thread_entry']);
    for (const c of calls) {
      expect(c.where.userId_type.userId).toBe('stu-1');
      expect(c.update).toEqual({ emailEnabled: false, pushEnabled: true });
    }

    // Ответ — category-форма (а не голый per-type массив).
    const json = res.json() as { preferences: Array<{ category: string; channelEmail: boolean; channelPush: boolean }> };
    expect(Array.isArray(json.preferences)).toBe(true);
    const feedback = json.preferences.find((p) => p.category === 'feedback');
    expect(feedback).toBeDefined();
    expect(feedback).toHaveProperty('channelEmail');
    expect(feedback).toHaveProperty('channelPush');
  });

  it('несколько категорий разом → upsert по сумме их типов', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      payload: {
        preferences: [
          { category: 'learning', channelEmail: true, channelPush: false }, // 2 типа
          { category: 'deadlines', channelEmail: false, channelPush: false }, // 1 тип
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(db.notificationPreference.upsert).toHaveBeenCalledTimes(3);
  });

  it('старый ГОЛЫЙ массив (без обёртки preferences) → 400, ничего не апсертим', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      payload: [{ type: 'thread_entry', pushEnabled: true }],
    });
    expect(res.statusCode).toBe(400);
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('неизвестная категория → 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      payload: { preferences: [{ category: 'system', channelPush: true }] },
    });
    expect(res.statusCode).toBe(400);
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('нечисловой флаг канала → 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      payload: { preferences: [{ category: 'feedback', channelPush: 'yes' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});

describe('GET /notification-preferences (category-форма, дефолт ВКЛ)', () => {
  it('нет записей → все категории с дефолтом ВКЛ', async () => {
    db.notificationPreference.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { preferences: Array<{ category: string; channelEmail: boolean; channelPush: boolean }> };
    // 5 реальных категорий (без system, без напоминаний).
    expect(json.preferences.map((p) => p.category).sort()).toEqual(
      ['deadlines', 'feedback', 'learning', 'schedule', 'student_activity'],
    );
    for (const p of json.preferences) {
      expect(p.channelEmail).toBe(true);
      expect(p.channelPush).toBe(true);
    }
  });

  it('сворачивает per-type записи обратно в категорию', async () => {
    // feedback = thread_entry + assignment_reviewed; оба push выключены → channelPush=false.
    db.notificationPreference.findMany.mockResolvedValue([
      { type: 'thread_entry', emailEnabled: true, pushEnabled: false, inAppEnabled: true },
      { type: 'assignment_reviewed', emailEnabled: true, pushEnabled: false, inAppEnabled: true },
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { preferences: Array<{ category: string; channelEmail: boolean; channelPush: boolean }> };
    const feedback = json.preferences.find((p) => p.category === 'feedback')!;
    expect(feedback.channelEmail).toBe(true);
    expect(feedback.channelPush).toBe(false);
  });
});
