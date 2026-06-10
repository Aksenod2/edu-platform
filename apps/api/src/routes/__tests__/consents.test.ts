// Тесты фиксации и чтения юридических согласий (Волна 1 «правовой минимум»):
// - POST /public/streams/join/:token с body.consents — фиксация с актуальными
//   версиями документов; МЯГКАЯ ДЕГРАДАЦИЯ, пока версий нет (регистрация работает);
// - POST /users/me/consents/marketing — append-запись granted/revoked, 409 без версии;
// - GET /users/me/consents и GET /users/:id/consents — история согласий.
// DB-free: prisma мокнута (по образцу streams-join.test.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';
process.env.CORS_ORIGIN = 'https://example.test';

// Мокаем prisma (DB-free). Prisma реэкспортируем настоящий — нужен для
// `err instanceof Prisma.*` в streams-public.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  const tx = {
    user: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    streamEnrollment: { create: vi.fn() },
    session: { findMany: vi.fn() },
    studentAssignment: { createMany: vi.fn() },
    stream: { findUnique: vi.fn() },
    charge: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    walletTransaction: { create: vi.fn() },
  };
  return {
    prisma: {
      stream: { findUnique: vi.fn() },
      user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      refreshToken: { create: vi.fn(), deleteMany: vi.fn() },
      legalDocumentVersion: { findMany: vi.fn(), findFirst: vi.fn() },
      userConsent: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
      // $transaction(callback) выполняет колбэк с tx-клиентом.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn((cb: any) => cb(tx)),
      __tx: tx,
    },
    Prisma: actual.Prisma,
  };
});

// S3 — no-op (issueSession строит подписанный avatarUrl).
vi.mock('../../lib/s3.js', () => ({
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}));

// bcrypt — детерминированный.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('hashed-pw')),
    compare: vi.fn(() => Promise.resolve(true)),
  },
}));

// Почта — no-op (auth.ts/users.ts импортируют отправку писем).
vi.mock('../../lib/email.js', () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
  sendInviteEmail: vi.fn(() => Promise.resolve()),
}));

import { streamsPublicRoutes } from '../streams-public.js';
import { authRoutes } from '../auth.js';
import { userRoutes } from '../users.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const tx = db.__tx;

const TEST_USER_AGENT = 'vitest-agent/1.0';

const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });
const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, 'user-agent': TEST_USER_AGENT };
}

function buildPublicApp(): FastifyInstance {
  const app = Fastify();
  app.register(cookie);
  app.register(streamsPublicRoutes);
  return app;
}

function buildAuthApp(): FastifyInstance {
  const app = Fastify();
  app.register(cookie);
  app.register(authRoutes);
  return app;
}

function buildAdminApp(): FastifyInstance {
  const app = Fastify();
  app.register(userRoutes);
  return app;
}

// Хелпер: настраивает успешную регистрацию по инвайт-ссылке (мок транзакции).
function mockSuccessfulJoin() {
  db.stream.findUnique.mockResolvedValueOnce({ id: 's-1', status: 'active' });
  tx.user.create.mockResolvedValueOnce({
    id: 'u-new',
    email: 'new@example.com',
    name: 'Новичок',
    lastName: 'Иванов',
    phone: '+79991234567',
    role: 'student',
    mustChangePassword: false,
    avatarKey: null,
  });
  tx.streamEnrollment.create.mockResolvedValueOnce({ id: 'enr-1' });
  tx.session.findMany.mockResolvedValueOnce([]);
  tx.stream.findUnique.mockResolvedValueOnce({ priceKopecks: null, billingType: 'one_time' });
  tx.user.findUnique.mockResolvedValueOnce({ isDemo: false });
  db.refreshToken.create.mockResolvedValueOnce({ id: 'rt-1' });
}

const joinBody = {
  email: 'new@example.com',
  name: 'Новичок',
  lastName: 'Иванов',
  phone: '+7 (999) 123-45-67',
  password: 'secret123',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Фиксация согласий при регистрации по инвайт-ссылке ───────────

describe('POST /public/streams/join/:token — согласия при регистрации', () => {
  it('фиксирует согласия с АКТУАЛЬНЫМИ версиями документов (ip + userAgent)', async () => {
    mockSuccessfulJoin();
    // Актуальные версии: orderBy versionNumber desc → первая на slug — актуальная.
    db.legalDocumentVersion.findMany.mockResolvedValueOnce([
      { id: 'ver-offer-2', document: { slug: 'offer' } },
      { id: 'ver-offer-1', document: { slug: 'offer' } },
      { id: 'ver-pd-1', document: { slug: 'pd-consent' } },
    ]);
    db.userConsent.createMany.mockResolvedValueOnce({ count: 3 });

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      headers: { 'user-agent': TEST_USER_AGENT },
      payload: { ...joinBody, consents: ['offer', 'personalData', 'serviceNotifications'] },
    });

    expect(res.statusCode).toBe(201);

    // Телефон нормализован, фамилия записана.
    const userArg = tx.user.create.mock.calls[0][0];
    expect(userArg.data.lastName).toBe('Иванов');
    expect(userArg.data.phone).toBe('+79991234567');

    // Журнал согласий: offer → актуальная версия оферты (ver-offer-2),
    // personalData И serviceNotifications → одна и та же версия pd-consent.
    expect(db.userConsent.createMany).toHaveBeenCalledTimes(1);
    const rows = db.userConsent.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({
        userId: 'u-new',
        consentType: 'offer',
        documentVersionId: 'ver-offer-2',
        action: 'granted',
        userAgent: TEST_USER_AGENT,
      }),
      expect.objectContaining({
        consentType: 'personalData',
        documentVersionId: 'ver-pd-1',
        action: 'granted',
      }),
      expect.objectContaining({
        consentType: 'serviceNotifications',
        documentVersionId: 'ver-pd-1',
        action: 'granted',
      }),
    ]);
    // IP зафиксирован (в inject это loopback, на проде — реальный за trustProxy).
    expect(rows[0].ip).toBeTruthy();
  });

  it('МЯГКАЯ ДЕГРАДАЦИЯ: версий ещё нет → согласия пропущены, регистрация работает (201)', async () => {
    mockSuccessfulJoin();
    db.legalDocumentVersion.findMany.mockResolvedValueOnce([]); // версии не опубликованы

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: { ...joinBody, consents: ['offer', 'personalData'] },
    });

    expect(res.statusCode).toBe(201);
    expect(db.userConsent.createMany).not.toHaveBeenCalled();
  });

  it('ошибка БД при записи журнала НЕ ломает регистрацию (201)', async () => {
    mockSuccessfulJoin();
    db.legalDocumentVersion.findMany.mockResolvedValueOnce([
      { id: 'ver-offer-1', document: { slug: 'offer' } },
    ]);
    db.userConsent.createMany.mockRejectedValueOnce(new Error('db down'));

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: { ...joinBody, consents: ['offer'] },
    });

    expect(res.statusCode).toBe(201);
  });

  it('без body.consents согласия не пишутся (поведение как раньше)', async () => {
    mockSuccessfulJoin();

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: joinBody,
    });

    expect(res.statusCode).toBe(201);
    expect(db.legalDocumentVersion.findMany).not.toHaveBeenCalled();
    expect(db.userConsent.createMany).not.toHaveBeenCalled();
  });

  it('неизвестное значение в consents → 400 (пользователь не создаётся)', async () => {
    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: { ...joinBody, consents: ['offer', 'wat'] },
    });

    expect(res.statusCode).toBe(400);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('невалидный телефон → 400', async () => {
    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      payload: { ...joinBody, phone: '12345' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('Некорректный формат телефона');
  });
});

// ─── Согласия при активации по приглашению ────────────────────────

describe('POST /auth/accept-invite — фамилия/телефон и согласия', () => {
  it('пишет lastName/нормализованный phone и фиксирует согласия после активации', async () => {
    db.user.findFirst.mockResolvedValueOnce({ id: 'u-inv' });
    db.user.update.mockResolvedValueOnce({ id: 'u-inv' });
    db.legalDocumentVersion.findMany.mockResolvedValueOnce([
      { id: 'ver-offer-1', document: { slug: 'offer' } },
    ]);
    db.userConsent.createMany.mockResolvedValueOnce({ count: 1 });

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/accept-invite',
      headers: { 'user-agent': TEST_USER_AGENT },
      payload: {
        token: 'invite-tok',
        password: 'secret123',
        lastName: 'Петров',
        phone: '8 (999) 111-22-33',
        consents: ['offer'],
      },
    });

    expect(res.statusCode).toBe(200);
    const updateArg = db.user.update.mock.calls[0][0];
    expect(updateArg.data).toMatchObject({ lastName: 'Петров', phone: '89991112233' });

    const rows = db.userConsent.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({
        userId: 'u-inv',
        consentType: 'offer',
        documentVersionId: 'ver-offer-1',
        action: 'granted',
      }),
    ]);
  });

  it('без версий документов активация всё равно проходит (мягкая деградация)', async () => {
    db.user.findFirst.mockResolvedValueOnce({ id: 'u-inv' });
    db.user.update.mockResolvedValueOnce({ id: 'u-inv' });
    db.legalDocumentVersion.findMany.mockResolvedValueOnce([]);

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/accept-invite',
      payload: { token: 'invite-tok', password: 'secret123', consents: ['offer'] },
    });

    expect(res.statusCode).toBe(200);
    expect(db.userConsent.createMany).not.toHaveBeenCalled();
  });
});

// ─── Отзыв/выдача маркетингового согласия из ЛК ───────────────────

describe('POST /users/me/consents/marketing', () => {
  it('granted=true → append-запись action=granted с актуальной версией', async () => {
    db.legalDocumentVersion.findFirst.mockResolvedValueOnce({ id: 'ver-mk-2', versionNumber: 2 });
    db.userConsent.create.mockResolvedValueOnce({
      id: 'c-1',
      consentType: 'marketing',
      action: 'granted',
      createdAt: new Date(),
    });

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents/marketing',
      headers: authHeaders(studentToken),
      payload: { granted: true },
    });

    expect(res.statusCode).toBe(201);
    const createArg = db.userConsent.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      userId: 'stu-1',
      documentVersionId: 'ver-mk-2',
      consentType: 'marketing',
      action: 'granted',
      userAgent: TEST_USER_AGENT,
    });
  });

  it('granted=false → append-запись action=revoked (отзыв рассылки)', async () => {
    db.legalDocumentVersion.findFirst.mockResolvedValueOnce({ id: 'ver-mk-2', versionNumber: 2 });
    db.userConsent.create.mockResolvedValueOnce({
      id: 'c-2',
      consentType: 'marketing',
      action: 'revoked',
      createdAt: new Date(),
    });

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents/marketing',
      headers: authHeaders(studentToken),
      payload: { granted: false },
    });

    expect(res.statusCode).toBe(201);
    expect(db.userConsent.create.mock.calls[0][0].data.action).toBe('revoked');
  });

  it('версий marketing-consent ещё нет → 409 с понятным сообщением', async () => {
    db.legalDocumentVersion.findFirst.mockResolvedValueOnce(null);

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents/marketing',
      headers: authHeaders(studentToken),
      payload: { granted: false },
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toContain('не опубликован');
    expect(db.userConsent.create).not.toHaveBeenCalled();
  });

  it('granted не boolean → 400', async () => {
    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents/marketing',
      headers: authHeaders(studentToken),
      payload: { granted: 'yes' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('без токена → 401', async () => {
    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents/marketing',
      payload: { granted: true },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ─── Чтение истории согласий ──────────────────────────────────────

const consentRow = {
  id: 'c-1',
  consentType: 'offer',
  action: 'granted',
  ip: '203.0.113.7',
  userAgent: TEST_USER_AGENT,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  documentVersion: {
    versionNumber: 2,
    document: { slug: 'offer', title: 'Договор-оферта' },
  },
};

describe('GET /users/me/consents — своя история', () => {
  it('отдаёт записи новыми сверху с документом и версией', async () => {
    db.userConsent.findMany.mockResolvedValueOnce([consentRow]);

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/users/me/consents',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { consents: Array<Record<string, unknown>> };
    expect(body.consents).toHaveLength(1);
    expect(body.consents[0]).toMatchObject({
      consentType: 'offer',
      action: 'granted',
      ip: '203.0.113.7',
      document: { slug: 'offer', title: 'Договор-оферта', versionNumber: 2 },
    });
    // Только свои записи + сортировка createdAt desc.
    const arg = db.userConsent.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'stu-1' });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
  });
});

describe('GET /users/:id/consents — история согласий ученика (admin)', () => {
  it('admin получает историю указанного пользователя', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'u-1' });
    db.userConsent.findMany.mockResolvedValueOnce([consentRow]);

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'GET',
      url: '/users/u-1/consents',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(db.userConsent.findMany.mock.calls[0][0].where).toEqual({ userId: 'u-1' });
  });

  it('несуществующий пользователь → 404', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'GET',
      url: '/users/missing/consents',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('студент → 403', async () => {
    const app = buildAdminApp();
    const res = await app.inject({
      method: 'GET',
      url: '/users/u-1/consents',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect(db.userConsent.findMany).not.toHaveBeenCalled();
  });
});
