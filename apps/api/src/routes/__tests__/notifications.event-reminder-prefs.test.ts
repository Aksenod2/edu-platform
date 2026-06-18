import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// DB-free: мокаем prisma — только методы, которые трогает узкий эндпоинт настроек
// напоминаний (issue #169). JWT-аутентификация (authenticate) для access-токена БД
// не дёргает — хватает валидного токена.
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
const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.notificationPreference.findMany.mockResolvedValue([]);
});

describe('GET /event-reminder-preferences', () => {
  it('401 без токена', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/event-reminder-preferences' });
    expect(res.statusCode).toBe(401);
  });

  it('нет записей → дефолт ВКЛ (remind60=true, remind15=true)', async () => {
    db.notificationPreference.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/event-reminder-preferences',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ remind60: true, remind15: true });
  });

  it('записи учитываются (pushEnabled), отсутствующий тип → дефолт ВКЛ', async () => {
    db.notificationPreference.findMany.mockResolvedValue([
      { type: 'event_reminder_60', pushEnabled: false },
      // event_reminder_15 записи нет → дефолт true
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/event-reminder-preferences',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ remind60: false, remind15: true });
    // Читаем только по своему userId и нужным типам.
    expect(db.notificationPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'admin-1', type: { in: ['event_reminder_60', 'event_reminder_15'] } },
      }),
    );
  });
});

describe('PATCH /event-reminder-preferences', () => {
  it('401 без токена', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/event-reminder-preferences',
      payload: { remind60: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it('меняет только переданный тумблер (upsert pushEnabled), возвращает актуальные', async () => {
    db.notificationPreference.upsert.mockResolvedValue({});
    // Перечитка после апсерта.
    db.notificationPreference.findMany.mockResolvedValue([
      { type: 'event_reminder_60', pushEnabled: false },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/event-reminder-preferences',
      headers: authHeaders(studentToken),
      payload: { remind60: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ remind60: false, remind15: true });
    // Апсертим только remind60 по ключу userId_type текущего пользователя.
    expect(db.notificationPreference.upsert).toHaveBeenCalledTimes(1);
    const call = db.notificationPreference.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId_type: { userId: 'stu-1', type: 'event_reminder_60' } });
    expect(call.update).toEqual({ pushEnabled: false });
  });

  it('оба тумблера → два upsert', async () => {
    db.notificationPreference.upsert.mockResolvedValue({});
    db.notificationPreference.findMany.mockResolvedValue([
      { type: 'event_reminder_60', pushEnabled: true },
      { type: 'event_reminder_15', pushEnabled: false },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/event-reminder-preferences',
      headers: authHeaders(studentToken),
      payload: { remind60: true, remind15: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ remind60: true, remind15: false });
    expect(db.notificationPreference.upsert).toHaveBeenCalledTimes(2);
  });

  it('нечисловой тумблер → 400, ничего не апсертим', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/event-reminder-preferences',
      headers: authHeaders(studentToken),
      payload: { remind60: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('пустое тело — без апсертов, возвращает дефолт ВКЛ', async () => {
    db.notificationPreference.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/event-reminder-preferences',
      headers: authHeaders(studentToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ remind60: true, remind15: true });
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
