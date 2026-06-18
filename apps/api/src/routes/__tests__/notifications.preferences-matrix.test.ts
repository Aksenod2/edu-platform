import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Тест-страж матрицы уведомлений (issue #172, контракт #174).
//
// Зачем: исторически форма тела PATCH /notification-preferences на ФРОНТЕ и БЭКЕ
// разошлась (фронт слал `{ preferences: [{ category, channelEmail, channelPush }] }`,
// бэк ждал голый массив `[{ type, ... }]`) → «Сохранить» падал 400. Контракт теперь
// ЕДИНЫЙ — zod-схема в @platform/shared/contracts, её же берёт фронт (z.infer) и бэк
// (validatorCompiler). Этот тест шлёт ИМЕННО то тело, что строит фронт-форма
// (handleSave в notification-settings.tsx), и требует 200 + корректный upsert.
//
// КРИТИЧНО: поднимаем app С zod-компиляторами (как server.ts) — иначе schema.body
// не валидируется так, как в проде, и страж был бы фиктивным.

vi.mock('@platform/db', () => ({
  prisma: {
    notification: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    notificationPreference: {
      findMany: vi.fn(() => Promise.resolve([])),
      upsert: vi.fn(() => Promise.resolve({})),
    },
  },
}));

import { notificationRoutes } from '../notifications.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import {
  CATEGORY_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
} from '@platform/shared/contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Поднимаем app КАК В ПРОДЕ: глобальные zod-компиляторы валидации/сериализации.
function buildApp(): FastifyInstance {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
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

describe('PATCH /notification-preferences — реальное тело фронт-формы (страж #172)', () => {
  it('401 без токена', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      payload: { preferences: [{ category: 'learning', channelEmail: true, channelPush: true }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('тело из handleSave (обёртка { preferences: [{category, channelEmail, channelPush}] }) → 200, НЕ 400', async () => {
    const app = buildApp();
    // Именно то, что строит фронт после правки контракта.
    const payload = {
      preferences: [
        { category: 'learning', channelEmail: false, channelPush: true },
        { category: 'feedback', channelEmail: true, channelPush: false },
      ],
    };
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      payload,
    });

    expect(res.statusCode).toBe(200);

    // Категория раскрыта в свои NotificationType, и каждый тип апсертнут по
    // ключу userId_type текущего пользователя с переданными каналами.
    const expectedTypes = [
      ...CATEGORY_NOTIFICATION_TYPES.learning,
      ...CATEGORY_NOTIFICATION_TYPES.feedback,
    ];
    expect(db.notificationPreference.upsert).toHaveBeenCalledTimes(expectedTypes.length);

    const upsertedTypes = db.notificationPreference.upsert.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0].where.userId_type.type,
    );
    expect(new Set(upsertedTypes)).toEqual(new Set(expectedTypes));

    // learning: channelEmail=false → emailEnabled=false во всех типах learning.
    for (const type of CATEGORY_NOTIFICATION_TYPES.learning) {
      const call = db.notificationPreference.upsert.mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c[0].where.userId_type.type === type,
      );
      expect(call[0].where.userId_type.userId).toBe('stu-1');
      expect(call[0].update).toEqual({ emailEnabled: false, pushEnabled: true });
    }
  });

  it('голый массив (старая форма бэка) отвергается валидатором → 400, без upsert', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      // Старое неверное тело: голый массив с type/emailEnabled — НЕ контракт.
      payload: [{ type: 'lesson_published', emailEnabled: false }],
    });
    expect(res.statusCode).toBe(400);
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('неизвестная категория → 400 (zod), без upsert', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      payload: { preferences: [{ category: 'bogus', channelEmail: true, channelPush: true }] },
    });
    expect(res.statusCode).toBe(400);
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('частичное обновление: передан только channelPush → в update нет emailEnabled', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
      payload: { preferences: [{ category: 'deadlines', channelPush: false }] },
    });
    expect(res.statusCode).toBe(200);
    const call = db.notificationPreference.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ pushEnabled: false });
  });
});

describe('GET /notification-preferences — category-based ответ', () => {
  it('нет записей → все категории с дефолтом ВКЛ', async () => {
    db.notificationPreference.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferences.map((p: { category: string }) => p.category)).toEqual([
      ...NOTIFICATION_CATEGORIES,
    ]);
    for (const p of body.preferences) {
      expect(p).toEqual({ category: p.category, channelEmail: true, channelPush: true });
    }
  });

  it('сворачивает per-type записи обратно в категорию', async () => {
    // learning = [lesson_published, assignment_created]; выключим email у одного.
    db.notificationPreference.findMany.mockResolvedValue([
      { type: 'lesson_published', emailEnabled: false, pushEnabled: true, inAppEnabled: true },
      { type: 'assignment_created', emailEnabled: false, pushEnabled: true, inAppEnabled: true },
    ]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/notification-preferences',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(200);
    const learning = res
      .json()
      .preferences.find((p: { category: string }) => p.category === 'learning');
    // оба типа learning с emailEnabled=false → channelEmail=false.
    expect(learning).toEqual({ category: 'learning', channelEmail: false, channelPush: true });
  });
});
