import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Тест-страж паритета «реальные роуты ↔ документация на /admin/api-access».
//
// Поднимаем Fastify со ВСЕМИ роутами (как в src/server.ts), собираем фактический
// набор {method, path} через хук onRoute, и сверяем его с перечнем из
// apps/web/src/lib/api-endpoints.ts (API_ENDPOINTS). Тест ПАДАЕТ, если:
//   - появился admin-доступный роут, которого нет в доке (рассинхрон → дополнить);
//   - в доке есть запись без реального роута (лишняя/опечатка → убрать/поправить).
// Из сверки исключаем служебные/неинтеграторские роуты (игнор-лист ниже).
//
// Регистрация роутов DB-free: мокаем @platform/db и побочные либы, чтобы плагины
// поднялись без подключения к БД и внешним сервисам. Хендлеры здесь не вызываются —
// нас интересует только инвентарь маршрутов.

// Минимальный прокси-мок prisma: любое обращение к prisma.<model>.<method>
// возвращает функцию-vi.fn(). Достаточно для регистрации роутов.
vi.mock('@platform/db', () => {
  const modelProxy: unknown = new Proxy(
    {},
    {
      get: () => vi.fn(),
    },
  );
  const prismaProxy: unknown = new Proxy(
    {},
    {
      get: () => modelProxy,
    },
  );
  return { prisma: prismaProxy };
});

vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
  deleteFile: vi.fn(() => Promise.resolve()),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}));

// web-push читает env при импорте — заглушка, чтобы push-роуты поднялись чисто.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(() => Promise.resolve()),
    generateVAPIDKeys: vi.fn(() => ({ publicKey: 'pub', privateKey: 'priv' })),
  },
}));

import { authRoutes } from '../auth.js';
import { streamRoutes } from '../streams.js';
import { streamsPublicRoutes } from '../streams-public.js';
import { legalPublicRoutes } from '../legal.js';
import { userRoutes } from '../users.js';
import { studentDynamicRoutes } from '../student-dynamic.js';
import { studentsRoutes } from '../students.js';
import { lessonRoutes } from '../lessons.js';
import { programRoutes } from '../programs.js';
import { assignmentRoutes } from '../assignments.js';
import { walletRoutes } from '../wallet.js';
import { paymentRoutes } from '../payments.js';
import { profileRoutes } from '../profiles.js';
import { threadRoutes } from '../threads.js';
import { conversationRoutes } from '../conversations.js';
import { notificationRoutes } from '../notifications.js';
import { pushSubscriptionRoutes } from '../push-subscriptions.js';
import { apiKeyRoutes } from '../api-keys.js';
import { fileRoutes } from '../files.js';
import { statsRoutes } from '../stats.js';
import { integrationRoutes } from '../integrations.js';
import { zoomWebhookRoutes } from '../zoom-webhooks.js';

import { API_ENDPOINTS } from '@platform/shared';

// Нормализуем путь: имена параметров не важны (важна позиция).
// `:foo`/`:bar` → `:p` чтобы сравнивать только структуру; в доке параметры —
// в стиле Fastify (`:id`, `:studentId`), поэтому одинаковая нормализация обеих сторон.
function normPath(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? ':p' : seg))
    .join('/');
}

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${normPath(path)}`;
}

// Служебные/неинтеграторские роуты — в доке их НЕ показываем (учитываем здесь).
// Публичные auth-роуты, вебхуки, публичное вступление в поток, health-check.
// Хранятся в нормализованном виде (через key()), как и фактический набор роутов.
const IGNORED = new Set<string>(
  [
    ['POST', '/auth/login'],
    ['POST', '/auth/refresh'],
    ['POST', '/auth/logout'],
    ['POST', '/auth/forgot-password'],
    ['POST', '/auth/reset-password'],
    ['POST', '/auth/accept-invite'],
    ['POST', '/webhooks/zoom/:webhookId'],
    ['GET', '/public/streams/join/:token'],
    ['POST', '/public/streams/join/:token'],
    ['GET', '/public/legal'],
    ['GET', '/public/legal/:slug'],
    ['GET', '/health'],
    ['GET', '/readiness'],
  ].map(([m, p]) => key(m, p)),
);

// Поднимаем приложение со всеми роутами (как в server.ts), собирая роуты через onRoute.
async function collectActualRoutes(): Promise<Set<string>> {
  const app: FastifyInstance = Fastify();
  const routes = new Set<string>();

  app.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const m of methods) {
      // HEAD/OPTIONS Fastify добавляет автоматически — нас интересуют «настоящие» методы.
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      routes.add(key(m, routeOptions.url));
    }
  });

  await app.register(authRoutes);
  await app.register(streamRoutes);
  await app.register(streamsPublicRoutes);
  await app.register(legalPublicRoutes);
  await app.register(userRoutes);
  await app.register(studentDynamicRoutes);
  await app.register(studentsRoutes);
  await app.register(lessonRoutes);
  await app.register(programRoutes);
  await app.register(assignmentRoutes);
  await app.register(walletRoutes);
  await app.register(paymentRoutes);
  await app.register(profileRoutes);
  await app.register(threadRoutes);
  await app.register(conversationRoutes);
  await app.register(notificationRoutes);
  await app.register(pushSubscriptionRoutes);
  await app.register(apiKeyRoutes);
  await app.register(fileRoutes);
  await app.register(statsRoutes);
  await app.register(integrationRoutes);
  await app.register(zoomWebhookRoutes);

  // health/readiness объявлены прямо в server.ts (не в плагинах) — добавляем вручную,
  // чтобы игнор-лист их учитывал и не было ложного «лишнего в доке».
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/readiness', async () => ({ status: 'ok' }));

  await app.ready();
  return routes;
}

describe('Паритет «роуты API ↔ документация /admin/api-access»', () => {
  it('каждый admin-доступный роут задокументирован, и нет лишних записей в доке', async () => {
    const actual = await collectActualRoutes();
    const documented = new Set(API_ENDPOINTS.map((e) => key(e.method, e.path)));

    // 1) Роуты без записи в доке (минус игнор-лист) — рассинхрон, дока неполна.
    const missingFromDocs = [...actual].filter(
      (r) => !IGNORED.has(r) && !documented.has(r),
    );

    // 2) Записи в доке без реального роута — лишнее/опечатка.
    const missingFromRoutes = [...documented].filter((r) => !actual.has(r));

    expect(
      { missingFromDocs, missingFromRoutes },
      `\nРоуты без записи в доке (api-endpoints.ts):\n  ${
        missingFromDocs.join('\n  ') || '—'
      }\nЗаписи в доке без реального роута:\n  ${
        missingFromRoutes.join('\n  ') || '—'
      }\n`,
    ).toEqual({ missingFromDocs: [], missingFromRoutes: [] });
  });

  it('игнор-лист содержит только реально существующие служебные роуты', async () => {
    const actual = await collectActualRoutes();
    const staleIgnored = [...IGNORED].filter((r) => !actual.has(r));
    expect(staleIgnored, `Устаревшие записи в игнор-листе: ${staleIgnored.join(', ')}`).toEqual([]);
  });
});
