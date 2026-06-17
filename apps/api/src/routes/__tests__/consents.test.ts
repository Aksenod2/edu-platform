// Тесты фиксации и чтения юридических согласий (Волна 1 «правовой минимум»):
// - POST /public/streams/join/:token с body.consents — фиксация с актуальными
//   версиями документов; МЯГКАЯ ДЕГРАДАЦИЯ, пока версий нет (регистрация работает);
// - POST /users/me/consents/marketing — append-запись granted/revoked, 409 без версии;
// - GET /users/me/consents и GET /users/:id/consents — история согласий;
// - Волна 1.1 (досбор согласий у существующих): pendingRequiredConsents,
//   POST /users/me/consents и поле pendingConsents в login/refresh (только студент).
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
      refreshToken: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
      legalDocument: { findMany: vi.fn() },
      legalDocumentVersion: { findMany: vi.fn(), findFirst: vi.fn() },
      userConsent: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
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
import { authenticate } from '../../middleware/auth.js';
import { consentGateHook, resetConsentGateCache } from '../../middleware/consent-gate.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import { pendingRequiredConsents, REQUIRED_CONSENT_TYPES } from '../../lib/consents.js';

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
  // Кэш серверного гейта — общий на модуль, между тестами сбрасываем обязательно.
  resetConsentGateCache();
  // Дефолты для pendingRequiredConsents (issueSession/refresh зовут его для студентов):
  // «записей и опубликованных документов нет». Конкретные тесты переопределяют
  // через mockResolvedValueOnce. Дефолт legalDocumentVersion — для recordConsents.
  db.userConsent.findMany.mockResolvedValue([]);
  db.legalDocument.findMany.mockResolvedValue([]);
  db.legalDocumentVersion.findMany.mockResolvedValue([]);
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
      { id: 'ver-pdp-1', document: { slug: 'personal-data-policy' } },
    ]);
    db.userConsent.createMany.mockResolvedValueOnce({ count: 4 });

    const app = buildPublicApp();
    const res = await app.inject({
      method: 'POST',
      url: '/public/streams/join/tok-1',
      headers: { 'user-agent': TEST_USER_AGENT },
      payload: {
        ...joinBody,
        consents: ['offer', 'personalData', 'personalDataPolicy', 'serviceNotifications'],
      },
    });

    expect(res.statusCode).toBe(201);

    // Телефон нормализован, фамилия записана.
    const userArg = tx.user.create.mock.calls[0][0];
    expect(userArg.data.lastName).toBe('Иванов');
    expect(userArg.data.phone).toBe('+79991234567');

    // Журнал согласий: offer → актуальная версия оферты (ver-offer-2),
    // personalData И serviceNotifications → одна и та же версия pd-consent,
    // personalDataPolicy → версия политики обработки ПДн (issue #130).
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
        consentType: 'personalDataPolicy',
        documentVersionId: 'ver-pdp-1',
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
    // legalDocument.findMany при этом ВЫЗЫВАЕТСЯ — pendingRequiredConsents
    // в issueSession (Волна 1.1), поэтому проверяем только отсутствие записи журнала.
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

// ─── Волна 1.1: недостающие обязательные согласия ─────────────────

// Документы всех обязательных типов с опубликованными версиями
// (offer → offer, personalData/serviceNotifications → pd-consent,
// personalDataPolicy → personal-data-policy, issue #130).
const publishedRequiredDocuments = [
  { slug: 'offer' },
  { slug: 'pd-consent' },
  { slug: 'personal-data-policy' },
];

describe('pendingRequiredConsents — недостающие обязательные согласия', () => {
  it('нет granted-записей, версии опубликованы → все обязательные типы', async () => {
    db.userConsent.findMany.mockResolvedValueOnce([]);
    db.legalDocument.findMany.mockResolvedValueOnce(publishedRequiredDocuments);

    await expect(pendingRequiredConsents('stu-1')).resolves.toEqual(REQUIRED_CONSENT_TYPES);

    // Granted-записи запрошены одним запросом по обязательным типам.
    const arg = db.userConsent.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      userId: 'stu-1',
      consentType: { in: REQUIRED_CONSENT_TYPES },
      action: 'granted',
    });
  });

  it('все обязательные granted → пусто (документы даже не запрашиваются)', async () => {
    db.userConsent.findMany.mockResolvedValueOnce(
      REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType })),
    );

    await expect(pendingRequiredConsents('stu-1')).resolves.toEqual([]);
    expect(db.legalDocument.findMany).not.toHaveBeenCalled();
  });

  it('часть granted → возвращается только остаток', async () => {
    db.userConsent.findMany.mockResolvedValueOnce([{ consentType: 'offer' }]);
    db.legalDocument.findMany.mockResolvedValueOnce(publishedRequiredDocuments);

    await expect(pendingRequiredConsents('stu-1')).resolves.toEqual([
      'personalData',
      'personalDataPolicy',
      'serviceNotifications',
    ]);
  });

  it('версий документов нет → типы НЕ блокируют (мягкая деградация)', async () => {
    db.userConsent.findMany.mockResolvedValueOnce([]);
    db.legalDocument.findMany.mockResolvedValueOnce([]);

    await expect(pendingRequiredConsents('stu-1')).resolves.toEqual([]);
  });

  // Issue #130: ровно сценарий СУЩЕСТВУЮЩИХ студентов после деплоя — старые
  // 3 обязательных уже granted, политика опубликована → долг только по новому типу.
  it('granted по старым 3 обязательным, политика опубликована → ровно [personalDataPolicy]', async () => {
    db.userConsent.findMany.mockResolvedValueOnce([
      { consentType: 'offer' },
      { consentType: 'personalData' },
      { consentType: 'serviceNotifications' },
    ]);
    db.legalDocument.findMany.mockResolvedValueOnce(publishedRequiredDocuments);

    await expect(pendingRequiredConsents('stu-1')).resolves.toEqual(['personalDataPolicy']);
  });
});

// ─── Волна 1.1: досбор согласий у существующих пользователей ──────

describe('POST /users/me/consents — досбор согласий', () => {
  it('фиксирует согласия и отдаёт 201 с оставшимися обязательными (пусто = гейт снят)', async () => {
    // pendingRequiredConsents ДО записи: granted-записей нет, версии опубликованы →
    // недоданы все 4 обязательных (фильтру дублей отсеивать нечего).
    db.userConsent.findMany.mockResolvedValueOnce([]);
    db.legalDocument.findMany.mockResolvedValueOnce(publishedRequiredDocuments);
    // recordConsents: актуальные версии всех затронутых документов.
    db.legalDocumentVersion.findMany.mockResolvedValueOnce([
      { id: 'ver-offer-1', document: { slug: 'offer' } },
      { id: 'ver-pd-1', document: { slug: 'pd-consent' } },
      { id: 'ver-pdp-1', document: { slug: 'personal-data-policy' } },
      { id: 'ver-mk-1', document: { slug: 'marketing-consent' } },
    ]);
    db.userConsent.createMany.mockResolvedValueOnce({ count: 5 });
    // pendingRequiredConsents ПОСЛЕ записи: все обязательные уже granted.
    db.userConsent.findMany.mockResolvedValueOnce(
      REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType })),
    );

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents',
      headers: authHeaders(studentToken),
      // marketing можно передавать вместе с обязательными.
      payload: { consents: [...REQUIRED_CONSENT_TYPES, 'marketing'] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ pendingConsents: [] });

    // Журнал append-only: записаны все 5 типов с ip/userAgent.
    const rows = db.userConsent.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { consentType: string }) => r.consentType)).toEqual([
      'offer',
      'personalData',
      'personalDataPolicy',
      'serviceNotifications',
      'marketing',
    ]);
    expect(rows[0]).toMatchObject({
      userId: 'stu-1',
      action: 'granted',
      userAgent: TEST_USER_AGENT,
    });
  });

  it('уже данные обязательные согласия повторно не журналируются (без дублей)', async () => {
    // ДО записи: offer уже granted → недоданы только
    // personalData/personalDataPolicy/serviceNotifications.
    db.userConsent.findMany.mockResolvedValueOnce([{ consentType: 'offer' }]);
    db.legalDocument.findMany.mockResolvedValueOnce(publishedRequiredDocuments);
    // recordConsents — только для отфильтрованных типов (+ marketing: append by design).
    db.legalDocumentVersion.findMany.mockResolvedValueOnce([
      { id: 'ver-pd-1', document: { slug: 'pd-consent' } },
      { id: 'ver-pdp-1', document: { slug: 'personal-data-policy' } },
      { id: 'ver-mk-1', document: { slug: 'marketing-consent' } },
    ]);
    db.userConsent.createMany.mockResolvedValueOnce({ count: 4 });
    // ПОСЛЕ записи: все обязательные granted.
    db.userConsent.findMany.mockResolvedValueOnce(
      REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType })),
    );

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents',
      headers: authHeaders(studentToken),
      payload: { consents: [...REQUIRED_CONSENT_TYPES, 'marketing'] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ pendingConsents: [] });

    // offer в журнал повторно не попал.
    const rows = db.userConsent.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { consentType: string }) => r.consentType)).toEqual([
      'personalData',
      'personalDataPolicy',
      'serviceNotifications',
      'marketing',
    ]);
  });

  it('неизвестное значение в consents → 400, журнал не пишется', async () => {
    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents',
      headers: authHeaders(studentToken),
      payload: { consents: ['offer', 'wat'] },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('Некорректный формат согласий');
    expect(db.userConsent.createMany).not.toHaveBeenCalled();
  });

  it('пустой массив согласий → 400', async () => {
    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents',
      headers: authHeaders(studentToken),
      payload: { consents: [] },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('Не передано ни одного согласия');
    expect(db.userConsent.createMany).not.toHaveBeenCalled();
  });

  it('без токена → 401', async () => {
    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents',
      payload: { consents: ['offer'] },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ─── Волна 1.1: pendingConsents в user-объекте сессии ─────────────

// Поля пользователя, нужные login/refresh для сборки user-объекта.
const sessionUserFields = {
  email: 'user@example.com',
  name: 'Пользователь',
  lastName: null,
  phone: null,
  isActive: true,
  passwordHash: 'hashed-pw',
  mustChangePassword: false,
  avatarKey: null,
  studentProfile: null,
};

describe('pendingConsents в login/refresh', () => {
  it('login: студент получает pendingConsents (версии опубликованы, согласий нет)', async () => {
    db.user.findUnique.mockResolvedValueOnce({
      ...sessionUserFields,
      id: 'stu-1',
      role: 'student',
    });
    db.refreshToken.create.mockResolvedValueOnce({ id: 'rt-1' });
    // granted-записей нет (дефолт []), версии обязательных документов опубликованы.
    db.legalDocument.findMany.mockResolvedValueOnce(publishedRequiredDocuments);

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com', password: 'secret123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { pendingConsents?: string[] } };
    expect(body.user.pendingConsents).toEqual(REQUIRED_CONSENT_TYPES);
  });

  it('login: у админа поля pendingConsents НЕТ (согласия не проверяются)', async () => {
    db.user.findUnique.mockResolvedValueOnce({
      ...sessionUserFields,
      id: 'admin-1',
      role: 'admin',
    });
    db.refreshToken.create.mockResolvedValueOnce({ id: 'rt-1' });

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com', password: 'secret123' },
    });

    expect(res.statusCode).toBe(200);
    expect('pendingConsents' in (res.json() as { user: object }).user).toBe(false);
    expect(db.userConsent.findMany).not.toHaveBeenCalled();
  });

  it('refresh: студент получает pendingConsents', async () => {
    db.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-1',
      userId: 'stu-1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: { ...sessionUserFields, id: 'stu-1', role: 'student' },
    });
    db.refreshToken.delete.mockResolvedValueOnce({});
    db.refreshToken.create.mockResolvedValueOnce({ id: 'rt-2' });
    db.legalDocument.findMany.mockResolvedValueOnce(publishedRequiredDocuments);

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refreshToken: 'tok-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { pendingConsents?: string[] } };
    expect(body.user.pendingConsents).toEqual(REQUIRED_CONSENT_TYPES);
  });

  it('refresh: у админа поля pendingConsents НЕТ', async () => {
    db.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-1',
      userId: 'admin-1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: { ...sessionUserFields, id: 'admin-1', role: 'admin' },
    });
    db.refreshToken.delete.mockResolvedValueOnce({});
    db.refreshToken.create.mockResolvedValueOnce({ id: 'rt-2' });

    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refreshToken: 'tok-1' },
    });

    expect(res.statusCode).toBe(200);
    expect('pendingConsents' in (res.json() as { user: object }).user).toBe(false);
    expect(db.userConsent.findMany).not.toHaveBeenCalled();
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

// ─── Issue #127: сброс согласий ДЕМО-аккаунта (admin) ─────────────
// Журнал append-only; ЕДИНСТВЕННОЕ исключение — демо-аккаунты (User.isDemo),
// чтобы заказчик мог повторно показывать механику гейта согласий.

describe('DELETE /users/:id/consents — сброс согласий демо-аккаунта', () => {
  it('демо-аккаунт: журнал удалён, ответ { deleted: count }', async () => {
    db.user.findUnique.mockResolvedValueOnce({ isDemo: true });
    db.userConsent.deleteMany.mockResolvedValueOnce({ count: 4 });

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/users/u-demo/consents',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 4 });
    expect(db.userConsent.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-demo' } });
  });

  it('несуществующий пользователь → 404, журнал не трогается', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/users/missing/consents',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
    expect(db.userConsent.deleteMany).not.toHaveBeenCalled();
  });

  it('НЕ-демо (реальный человек) → 403, журнал НЕ трогается ни при каких условиях', async () => {
    db.user.findUnique.mockResolvedValueOnce({ isDemo: false });

    const app = buildAdminApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/users/u-real/consents',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe(
      'Сброс согласий доступен только для демо-аккаунтов',
    );
    expect(db.userConsent.deleteMany).not.toHaveBeenCalled();
  });

  it('студент → 403 (requireRole admin), до проверок роута не доходит', async () => {
    const app = buildAdminApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/users/u-demo/consents',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.userConsent.deleteMany).not.toHaveBeenCalled();
  });

  it('после сброса серверный гейт СРАЗУ требует согласия (кэш «долга нет» очищен, без ожидания TTL)', async () => {
    // Приложение как server.ts: глобальный preHandler-гейт + админские роуты +
    // /protected как представитель гейтуемых студенческих эндпоинтов.
    const app = Fastify();
    app.addHook('preHandler', consentGateHook);
    app.register(userRoutes);
    app.get('/protected', { onRequest: authenticate }, async () => ({ ok: true }));

    // 1. Демо-студент без долга → гейт кэширует «долга нет» (TTL 60с).
    db.userConsent.findMany.mockResolvedValue(
      REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType })),
    );
    const before = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });
    expect(before.statusCode).toBe(200);
    expect(db.userConsent.findMany).toHaveBeenCalledTimes(1);

    // Контроль кэша: повторный запрос обслужен БЕЗ похода в БД.
    const cached = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });
    expect(cached.statusCode).toBe(200);
    expect(db.userConsent.findMany).toHaveBeenCalledTimes(1);

    // 2. Админ сбрасывает согласия демо-аккаунта.
    db.user.findUnique.mockResolvedValueOnce({ isDemo: true });
    db.userConsent.deleteMany.mockResolvedValueOnce({ count: 3 });
    const reset = await app.inject({
      method: 'DELETE',
      url: '/users/stu-1/consents',
      headers: authHeaders(adminToken),
    });
    expect(reset.statusCode).toBe(200);

    // 3. Состояние БД после сброса: granted-записей нет, версии опубликованы.
    db.userConsent.findMany.mockResolvedValue([]);
    db.legalDocument.findMany.mockResolvedValue(publishedRequiredDocuments);

    // Гейт снова дёргает БД (кэш очищен clearConsentGateCache) и блокирует —
    // без очистки кэша тут было бы 200 из кэша ещё до 60 секунд.
    const after = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });
    expect(after.statusCode).toBe(403);
    expect((after.json() as { code: string }).code).toBe('CONSENTS_REQUIRED');
    expect(db.userConsent.findMany).toHaveBeenCalledTimes(2);
  });
});
