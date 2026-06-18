// Тесты серверного гейта обязательных согласий (issue #119): глобальный
// preHandler consentGateHook блокирует студента с недоданными ОБЯЗАТЕЛЬНЫМИ
// согласиями (403 CONSENTS_REQUIRED) на всех роутах, кроме исключений
// (auth-флоу, досбор согласий, /public/* (включая /public/legal), /health, вебхуки, файлы).
// Положительный результат («долга нет») кэшируется на TTL, отрицательный — нет.
// DB-free: prisma мокнута (по образцу consents.test.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';
process.env.CORS_ORIGIN = 'https://example.test';

// Мокаем prisma (DB-free). Prisma реэкспортируем настоящий.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return {
    prisma: {
      user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      refreshToken: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
      apiKey: { findUnique: vi.fn(), update: vi.fn() },
      legalDocument: { findMany: vi.fn() },
      legalDocumentVersion: { findMany: vi.fn(), findFirst: vi.fn() },
      userConsent: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
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

// Почта — no-op (auth.ts импортирует отправку писем).
vi.mock('../../lib/email.js', () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
  sendInviteEmail: vi.fn(() => Promise.resolve()),
}));

import { authRoutes } from '../auth.js';
import { authenticate } from '../../middleware/auth.js';
import { consentGateHook, resetConsentGateCache } from '../../middleware/consent-gate.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import { REQUIRED_CONSENT_TYPES } from '../../lib/consents.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });
const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Тестовое приложение — как server.ts: глобальный preHandler-гейт ДО
// регистрации роутов. /protected — представитель всех «обычных» гейтуемых
// эндпоинтов; /legal/docs и /public/ping — фиктивные роуты на исключённых
// префиксах (доказывают пропуск по пути даже для аутентифицированного студента).
function buildGatedApp(): FastifyInstance {
  const app = Fastify();
  app.register(cookie);
  app.addHook('preHandler', consentGateHook);
  app.register(authRoutes);
  app.get('/protected', { onRequest: authenticate }, async () => ({ ok: true }));
  app.get('/public/legal', { onRequest: authenticate }, async () => ({ ok: true }));
  app.get('/public/ping', { onRequest: authenticate }, async () => ({ ok: true }));
  return app;
}

// Документы всех обязательных типов с опубликованными версиями
// (включая personal-data-policy — обязательный personalDataPolicy, issue #130).
const publishedRequiredDocuments = [
  { slug: 'offer' },
  { slug: 'pd-consent' },
  { slug: 'personal-data-policy' },
  { slug: 'meeting-recording-consent' },
];

// granted-записи по всем обязательным типам («долга нет»).
const allRequiredGranted = REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType }));

// Долг по всем обязательным типам: granted-записей нет, версии опубликованы.
function mockStudentWithDebt() {
  db.userConsent.findMany.mockResolvedValue([]);
  db.legalDocument.findMany.mockResolvedValue(publishedRequiredDocuments);
}

// Поля пользователя для issueSession (тест /auth/refresh).
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

beforeEach(() => {
  vi.clearAllMocks();
  // Кэш гейта — общий на модуль, между тестами сбрасываем обязательно.
  resetConsentGateCache();
  // Дефолты «долга нет» (мягкая деградация: документы не опубликованы).
  db.userConsent.findMany.mockResolvedValue([]);
  db.legalDocument.findMany.mockResolvedValue([]);
  db.legalDocumentVersion.findMany.mockResolvedValue([]);
  // authenticate по sk_ обновляет lastUsedAt fire-and-forget через .catch —
  // мок должен возвращать промис.
  db.apiKey.update.mockResolvedValue({});
});

describe('consentGateHook — студент с долгом по согласиям', () => {
  it('обычный роут → 403 с code=CONSENTS_REQUIRED и списком недостающих', async () => {
    mockStudentWithDebt();

    const app = buildGatedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: 'Для продолжения работы примите обязательные согласия',
      code: 'CONSENTS_REQUIRED',
      pendingConsents: REQUIRED_CONSENT_TYPES,
    });
  });

  it('query-string не спасает от гейта (матчим путь без query)', async () => {
    mockStudentWithDebt();

    const app = buildGatedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected?foo=bar',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('CONSENTS_REQUIRED');
  });

  it('НЕ блокирует /auth/refresh (студент должен мочь обновить сессию)', async () => {
    mockStudentWithDebt();
    db.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-1',
      userId: 'stu-1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      user: { ...sessionUserFields, id: 'stu-1', role: 'student' },
    });
    db.refreshToken.delete.mockResolvedValueOnce({});
    db.refreshToken.create.mockResolvedValueOnce({ id: 'rt-2' });

    const app = buildGatedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refreshToken: 'tok-1' },
    });

    expect(res.statusCode).toBe(200);
    // Долг виден в pendingConsents user-объекта (Волна 1.1), но не блокирует.
    const body = res.json() as { user: { pendingConsents?: string[] } };
    expect(body.user.pendingConsents).toEqual(REQUIRED_CONSENT_TYPES);
  });

  it('НЕ блокирует POST /users/me/consents (сам досбор согласий)', async () => {
    mockStudentWithDebt();
    db.legalDocumentVersion.findMany.mockResolvedValue([
      { id: 'ver-offer-1', document: { slug: 'offer' } },
      { id: 'ver-pd-1', document: { slug: 'pd-consent' } },
      { id: 'ver-pdp-1', document: { slug: 'personal-data-policy' } },
      { id: 'ver-mr-1', document: { slug: 'meeting-recording-consent' } },
    ]);
    db.userConsent.createMany.mockResolvedValueOnce({ count: 5 });

    const app = buildGatedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/consents',
      headers: authHeaders(studentToken),
      payload: { consents: REQUIRED_CONSENT_TYPES },
    });

    expect(res.statusCode).toBe(201);
    expect(db.userConsent.createMany).toHaveBeenCalledTimes(1);
  });

  it('НЕ блокирует /public/* (тексты документов /public/legal читаемы до согласий)', async () => {
    mockStudentWithDebt();

    const app = buildGatedApp();
    const legalRes = await app.inject({
      method: 'GET',
      url: '/public/legal',
      headers: authHeaders(studentToken),
    });
    const publicRes = await app.inject({
      method: 'GET',
      url: '/public/ping',
      headers: authHeaders(studentToken),
    });

    expect(legalRes.statusCode).toBe(200);
    expect(publicRes.statusCode).toBe(200);
    // До проверки долга гейт даже не дошёл — БД не дёргалась.
    expect(db.userConsent.findMany).not.toHaveBeenCalled();
  });
});

describe('consentGateHook — студент без долга и кэш', () => {
  it('проходит; повторный запрос в течение TTL не дёргает БД (кэш положительного)', async () => {
    db.userConsent.findMany.mockResolvedValue(allRequiredGranted);

    const app = buildGatedApp();
    const first = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });
    expect(first.statusCode).toBe(200);
    expect(db.userConsent.findMany).toHaveBeenCalledTimes(1);

    const second = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });
    expect(second.statusCode).toBe(200);
    // Второй запрос обслужен из кэша — новых походов в БД нет.
    expect(db.userConsent.findMany).toHaveBeenCalledTimes(1);
  });

  it('после выдачи согласий доступ открывается СРАЗУ (отрицательный результат не кэшируется)', async () => {
    db.legalDocument.findMany.mockResolvedValue(publishedRequiredDocuments);
    // База: согласия уже даны; Once-очередь моделирует состояние ДО выдачи.
    db.userConsent.findMany.mockResolvedValue(allRequiredGranted);
    db.userConsent.findMany
      .mockResolvedValueOnce([]) // гейт на /protected: долг есть
      .mockResolvedValueOnce([]); // pendingBefore внутри POST /users/me/consents
    db.legalDocumentVersion.findMany.mockResolvedValue([
      { id: 'ver-offer-1', document: { slug: 'offer' } },
      { id: 'ver-pd-1', document: { slug: 'pd-consent' } },
      { id: 'ver-pdp-1', document: { slug: 'personal-data-policy' } },
      { id: 'ver-mr-1', document: { slug: 'meeting-recording-consent' } },
    ]);
    db.userConsent.createMany.mockResolvedValueOnce({ count: 5 });

    const app = buildGatedApp();

    // 1. С долгом — заблокирован.
    const blocked = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });
    expect(blocked.statusCode).toBe(403);

    // 2. Выдаёт согласия (роут вне гейта).
    const consentsRes = await app.inject({
      method: 'POST',
      url: '/users/me/consents',
      headers: authHeaders(studentToken),
      payload: { consents: REQUIRED_CONSENT_TYPES },
    });
    expect(consentsRes.statusCode).toBe(201);
    expect(consentsRes.json()).toEqual({ pendingConsents: [] });

    // 3. Следующий запрос проходит сразу — 403 не «залип» в кэше.
    const allowed = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(studentToken),
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe('consentGateHook — не-студенты и API-ключи', () => {
  it('админ по JWT не гейтится, долг даже не проверяется', async () => {
    mockStudentWithDebt(); // моки долга есть, но для админа неприменимы

    const app = buildGatedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(db.userConsent.findMany).not.toHaveBeenCalled();
  });

  it('API-ключ админа (sk_) не гейтится, долг не проверяется', async () => {
    mockStudentWithDebt();
    db.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      revokedAt: null,
      user: { id: 'admin-1', role: 'admin', isActive: true, deletedAt: null },
    });

    const app = buildGatedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders('sk_admin_test_key'),
    });

    expect(res.statusCode).toBe(200);
    expect(db.userConsent.findMany).not.toHaveBeenCalled();
  });

  it('API-ключ СТУДЕНТА (sk_) гейтится так же, как JWT', async () => {
    mockStudentWithDebt();
    db.apiKey.findUnique.mockResolvedValue({
      id: 'key-2',
      revokedAt: null,
      user: { id: 'stu-1', role: 'student', isActive: true, deletedAt: null },
    });

    const app = buildGatedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders('sk_student_test_key'),
    });

    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('CONSENTS_REQUIRED');
  });
});

// ─── Инвариант: authenticate только в onRequest (issue #119) ──────

describe('инвариант фаз хуков: authenticate не подключается в preHandler', () => {
  it('в apps/api/src нет preHandler-подключений authenticate/anyAuth', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');

    // Глобальный preHandler-гейт согласий (middleware/consent-gate.ts) полагается
    // на request.user, установленный в фазе onRequest. authenticate, подключённый
    // в preHandler, выполнился бы ПОЗЖЕ гейта — и студент с недоданными согласиями
    // МОЛЧА обошёл бы гейт на всём плагине (ровно так было у threads/notifications/
    // push-subscriptions до issue #119). Этот тест ловит такую регрессию.
    // requireRole('admin') в preHandler допустим: студент на админских роутах
    // отсечётся самим requireRole, данных не получит.
    const srcDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts')) {
          const text = fs.readFileSync(full, 'utf8');
          if (/preHandler['"]?\s*[,:]\s*\[?\s*(authenticate|anyAuth)\b/.test(text)) {
            offenders.push(path.relative(srcDir, full));
          }
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
