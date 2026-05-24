import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые вызывает paymentRoutes (DB-free).
vi.mock('@platform/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    topUpRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    charge: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentSettings: { upsert: vi.fn() },
    walletTransaction: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Мокаем уведомления: проверяем факт fan-out админам, без реальной БД/почты/пуша.
vi.mock('../../lib/notifications.js', () => ({
  notifyMany: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
}));

// Мокаем S3-хелперы (без сети): загрузка возвращает фиксированный ключ, getFileUrl — подписанную ссылку.
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(async (_buf: Buffer, name: string, _mime: string, folder: string) => ({
    key: `${folder}/uploaded-${name}`,
    url: `/files/${folder}/uploaded-${name}`,
    size: 1,
  })),
  getFileUrl: vi.fn(async (key: string) => `https://signed.example/${encodeURIComponent(key)}`),
  MAX_FILE_SIZE: 50 * 1024 * 1024,
}));

import multipart from '@fastify/multipart';
import { paymentRoutes } from '../payments.js';
import { prisma } from '@platform/db';
import { notifyMany } from '../../lib/notifications.js';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const notifyManyMock = vi.mocked(notifyMany);

// Заявка на пополнение создаётся успешно с заданным id (общий стаб для тестов уведомления).
function stubCreatedRequest(id = 'req-1', claimedAmountKopecks: number | null = 100000) {
  db.topUpRequest.findFirst.mockResolvedValueOnce(null); // нет pending
  db.topUpRequest.create.mockResolvedValueOnce({
    id,
    status: 'pending',
    claimedAmountKopecks,
    createdAt: new Date('2026-05-23T10:00:00Z'),
  });
}

// Ждём, пока асинхронный best-effort fan-out (void IIFE) успеет выполниться.
async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(paymentRoutes);
  await app.ready();
  return app;
}

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });
const studentToken = (id: string) => signAccessToken({ userId: id, role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Собирает multipart/form-data вручную (без зависимости form-data): один файл +
// опциональные текстовые поля. Поля идут ПОСЛЕ файла — проверяем, что роут читает
// их через request.parts() независимо от порядка.
function buildMultipart(opts: {
  fileName?: string;
  contentType?: string;
  fields?: Record<string, string>;
}): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----vitestBoundary' + Math.random().toString(16).slice(2);
  const CRLF = '\r\n';
  const parts: Buffer[] = [];

  parts.push(
    Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${opts.fileName ?? 'screenshot.png'}"${CRLF}` +
        `Content-Type: ${opts.contentType ?? 'image/png'}${CRLF}${CRLF}`,
    ),
  );
  parts.push(Buffer.from('fake-image-bytes'));
  parts.push(Buffer.from(CRLF));

  for (const [k, v] of Object.entries(opts.fields ?? {})) {
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}` +
          `${v}${CRLF}`,
      ),
    );
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));

  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── POST /topup-requests (студент создаёт заявку) ────────────────────────────

describe('POST /topup-requests', () => {
  it('201 — успешное создание заявки (без screenshotKey в ответе)', async () => {
    db.topUpRequest.findFirst.mockResolvedValueOnce(null); // нет pending
    db.topUpRequest.create.mockResolvedValueOnce({
      id: 'req-1',
      status: 'pending',
      claimedAmountKopecks: 100000,
      createdAt: new Date('2026-05-23T10:00:00Z'),
    });

    const app = await buildApp();
    const mp = buildMultipart({ fields: { claimedAmountKopecks: '100000', note: 'перевёл' } });
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe('req-1');
    expect(body.status).toBe('pending');
    expect(body.screenshotKey).toBeUndefined();
    // Заявка привязана к userId из токена.
    expect(db.topUpRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 's-1', status: 'pending', claimedAmountKopecks: 100000 }),
      }),
    );
  });

  it('409 — анти-спам: уже есть pending-заявка', async () => {
    db.topUpRequest.findFirst.mockResolvedValueOnce({ id: 'existing' });

    const app = await buildApp();
    const mp = buildMultipart({});
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('У вас уже есть заявка на рассмотрении');
    expect(db.topUpRequest.create).not.toHaveBeenCalled();
  });

  it('400 — неверный mime файла (не изображение)', async () => {
    const app = await buildApp();
    const mp = buildMultipart({ fileName: 'doc.pdf', contentType: 'application/pdf' });
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(db.topUpRequest.create).not.toHaveBeenCalled();
  });

  it('400 — claimedAmountKopecks дробный', async () => {
    db.topUpRequest.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const mp = buildMultipart({ fields: { claimedAmountKopecks: '100.5' } });
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(db.topUpRequest.create).not.toHaveBeenCalled();
  });

  it('401 — без токена', async () => {
    const app = await buildApp();
    const mp = buildMultipart({});
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /topup-requests — уведомление админам о новой заявке ─────────────────

describe('POST /topup-requests — уведомление админам', () => {
  it('уведомляет всех админов с типом topup_requested (имя студента + сумма)', async () => {
    stubCreatedRequest('req-1', 500000); // 5 000 ₽
    db.user.findUnique.mockResolvedValueOnce({ name: 'Иван Петров' }); // имя студента
    db.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }, { id: 'admin-2' }]); // админы

    const app = await buildApp();
    const mp = buildMultipart({ fields: { claimedAmountKopecks: '500000' } });
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(201);
    await flushAsync();

    // Админов выбираем строго по роли.
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { role: 'admin' },
      select: { id: true },
    });
    // Fan-out на всех админов с нужным типом, заголовком и metadata.
    expect(notifyManyMock).toHaveBeenCalledTimes(1);
    const [userIds, type, title, body, metadata] = notifyManyMock.mock.calls[0];
    expect(userIds).toEqual(['admin-1', 'admin-2']);
    expect(type).toBe('topup_requested');
    expect(title).toBe('Новая заявка на пополнение');
    // Тело: имя студента + сумма в рублях. Нормализуем пробелы (toLocaleString может
    // ставить неразрывный пробел-разделитель тысяч в зависимости от ICU).
    expect(body.replace(/[\u00A0\u202F]/g, ' ')).toBe('Иван Петров · 5 000 ₽');
    expect(metadata).toEqual({ studentId: 's-1', requestId: 'req-1' });
  });

  it('без указанной суммы — тело «<имя> приложил оплату»', async () => {
    stubCreatedRequest('req-2', null);
    db.user.findUnique.mockResolvedValueOnce({ name: 'Мария Сидорова' });
    db.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);

    const app = await buildApp();
    const mp = buildMultipart({}); // без claimedAmountKopecks
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(201);
    await flushAsync();

    expect(notifyManyMock).toHaveBeenCalledWith(
      ['admin-1'],
      'topup_requested',
      'Новая заявка на пополнение',
      'Мария Сидорова приложил оплату',
      { studentId: 's-1', requestId: 'req-2' },
    );
  });

  it('ошибка уведомления НЕ ломает создание заявки (всё равно 201)', async () => {
    stubCreatedRequest('req-3', 100000);
    db.user.findUnique.mockResolvedValueOnce({ name: 'Студент' });
    db.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
    notifyManyMock.mockRejectedValueOnce(new Error('почта недоступна'));

    const app = await buildApp();
    const mp = buildMultipart({ fields: { claimedAmountKopecks: '100000' } });
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    // Заявка создана, несмотря на сбой уведомления.
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('req-3');
    await flushAsync();
    expect(notifyManyMock).toHaveBeenCalled();
  });

  it('нет админов — уведомление не отправляется, заявка создаётся', async () => {
    stubCreatedRequest('req-4', 100000);
    db.user.findUnique.mockResolvedValueOnce({ name: 'Студент' });
    db.user.findMany.mockResolvedValueOnce([]); // админов нет

    const app = await buildApp();
    const mp = buildMultipart({ fields: { claimedAmountKopecks: '100000' } });
    const res = await app.inject({
      method: 'POST',
      url: '/topup-requests',
      headers: { ...authHeaders(studentToken('s-1')), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(201);
    await flushAsync();
    expect(notifyManyMock).not.toHaveBeenCalled();
  });
});

// ─── GET /topup-requests/me (студент видит только свои) ───────────────────────

describe('GET /topup-requests/me', () => {
  it('200 — свои заявки с подписанным screenshotUrl', async () => {
    db.topUpRequest.findMany.mockResolvedValueOnce([
      {
        id: 'req-1',
        status: 'pending',
        claimedAmountKopecks: 5000,
        creditedAmountKopecks: null,
        note: null,
        screenshotKey: 'topups/a.png',
        reviewedAt: null,
        createdAt: new Date('2026-05-23T10:00:00Z'),
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/topup-requests/me',
      headers: authHeaders(studentToken('s-1')),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].screenshotUrl).toContain('signed.example');
    expect(body.requests[0].screenshotKey).toBeUndefined();
    // Запрос только по userId из токена.
    expect(db.topUpRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 's-1' } }),
    );
  });
});

// ─── Авторизация admin-эндпоинтов ─────────────────────────────────────────────

describe('авторизация admin-эндпоинтов', () => {
  it('403 — студент не может смотреть список заявок', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/topup-requests',
      headers: authHeaders(studentToken('s-1')),
    });
    expect(res.statusCode).toBe(403);
    expect(db.topUpRequest.findMany).not.toHaveBeenCalled();
  });

  it('403 — студент не может одобрять заявку', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/approve',
      headers: authHeaders(studentToken('s-1')),
      payload: { amountKopecks: 1000 },
    });
    expect(res.statusCode).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('403 — студент не может менять настройки оплаты', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/payment-settings',
      headers: authHeaders(studentToken('s-1')),
      payload: { transferPhone: '+79990000000' },
    });
    expect(res.statusCode).toBe(403);
    expect(db.paymentSettings.upsert).not.toHaveBeenCalled();
  });
});

// ─── GET /admin/topup-requests ────────────────────────────────────────────────

describe('GET /admin/topup-requests', () => {
  it('200 — список с user и подписанным screenshotUrl (default pending)', async () => {
    db.topUpRequest.findMany.mockResolvedValueOnce([
      {
        id: 'req-1',
        status: 'pending',
        claimedAmountKopecks: 5000,
        creditedAmountKopecks: null,
        note: null,
        screenshotKey: 'topups/a.png',
        reviewedAt: null,
        createdAt: new Date('2026-05-23T10:00:00Z'),
        user: { id: 's-1', name: 'Студент', email: 's@e.x' },
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/topup-requests',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(db.topUpRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' } }),
    );
    const body = res.json();
    expect(body.requests[0].user.email).toBe('s@e.x');
    expect(body.requests[0].screenshotUrl).toContain('signed.example');
    expect(body.requests[0].screenshotKey).toBeUndefined();
  });

  it('200 — status=all снимает фильтр по статусу', async () => {
    db.topUpRequest.findMany.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/topup-requests?status=all',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(db.topUpRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

// ─── POST /admin/topup-requests/:id/approve ───────────────────────────────────

// Мок callback-формы $transaction: вызывает переданный колбэк с tx-объектом,
// собранным из методов prisma-мока (как ведёт себя реальный интерактивный $transaction).
function mockTxCallback() {
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      topUpRequest: db.topUpRequest,
      user: db.user,
      walletTransaction: db.walletTransaction,
      charge: db.charge,
    };
    return cb(tx);
  });
}

describe('POST /admin/topup-requests/:id/approve', () => {
  it('400 — невалидная сумма (0)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/approve',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('400 — невалидная сумма (дробная)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/approve',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 99.9 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('200 — одобрение зачисляет баланс и возвращает request/transaction', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' }); // имя админа
    mockTxCallback();
    db.topUpRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.topUpRequest.findUniqueOrThrow
      .mockResolvedValueOnce({ userId: 's-1' }) // target
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'approved',
        claimedAmountKopecks: 5000,
        creditedAmountKopecks: 5000,
        note: null,
        reviewedAt: new Date(),
        createdAt: new Date(),
      });
    // creditBalance: user.update (increment) + walletTransaction.create
    db.user.update.mockResolvedValueOnce({ balanceKopecks: 5000 });
    db.walletTransaction.create.mockResolvedValueOnce({ id: 'tx-1', kind: 'topup', amount: 5000 });
    db.topUpRequest.update.mockResolvedValueOnce({});
    // settleOutstandingCharges: нет открытых начислений → ничего не списываем.
    db.charge.findMany.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/approve',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 5000 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balanceKopecks).toBe(5000);
    expect(body.transaction.id).toBe('tx-1');
    expect(body.request.status).toBe('approved');
    // Привязали walletTransactionId к заявке.
    expect(db.topUpRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletTransactionId: 'tx-1' } }),
    );
    expect(db.walletTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('409 — повторное одобрение (уже обработана); баланс не двоится', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' });
    mockTxCallback();
    // Заявка уже не pending → updateMany не затронул строк.
    db.topUpRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/approve',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 5000 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Заявка уже обработана');
    // Баланс НЕ трогали и транзакцию НЕ создавали (откат на сентинел-ошибке).
    expect(db.walletTransaction.create).not.toHaveBeenCalled();
    expect(db.topUpRequest.update).not.toHaveBeenCalled();
  });
});

// ─── POST /admin/topup-requests/:id/reject ────────────────────────────────────

describe('POST /admin/topup-requests/:id/reject', () => {
  it('200 — отклонение pending-заявки', async () => {
    db.topUpRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.topUpRequest.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'req-1',
      status: 'rejected',
      claimedAmountKopecks: 5000,
      creditedAmountKopecks: null,
      note: 'не тот скрин',
      reviewedAt: new Date(),
      createdAt: new Date(),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/reject',
      headers: authHeaders(adminToken),
      payload: { note: 'не тот скрин' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().request.status).toBe('rejected');
    expect(db.topUpRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-1', status: 'pending' } }),
    );
  });

  it('409 — заявка уже обработана', async () => {
    db.topUpRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/reject',
      headers: authHeaders(adminToken),
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Заявка уже обработана');
    expect(db.topUpRequest.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

// ─── POST /admin/charges/:id/refund (возврат по начислению) ───────────────────

describe('POST /admin/charges/:id/refund', () => {
  it('403 — студент не может делать возврат', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/charges/c-1/refund',
      headers: authHeaders(studentToken('s-1')),
      payload: { amountKopecks: 1000 },
    });
    expect(res.statusCode).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('400 — невалидная сумма (0)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/charges/c-1/refund',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(db.charge.findUnique).not.toHaveBeenCalled();
  });

  it('404 — начисление не найдено', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' });
    db.charge.findUnique.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/charges/missing/refund',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 — сумма возврата больше уплаченной', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' });
    db.charge.findUnique.mockResolvedValueOnce({
      id: 'c-1',
      userId: 's-1',
      paidKopecks: 3000,
      status: 'paid',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/charges/c-1/refund',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 5000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Сумма возврата больше уплаченной');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('409 — начисление уже возвращено', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' });
    db.charge.findUnique.mockResolvedValueOnce({
      id: 'c-1',
      userId: 's-1',
      paidKopecks: 3000,
      status: 'refunded',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/charges/c-1/refund',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });
    expect(res.statusCode).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('200 — возврат уменьшает paidKopecks, помечает refunded и кредитует баланс', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' });
    db.charge.findUnique.mockResolvedValueOnce({
      id: 'c-1',
      userId: 's-1',
      paidKopecks: 3000,
      status: 'paid',
    });
    mockTxCallback();
    db.charge.updateMany.mockResolvedValueOnce({ count: 1 });
    // creditBalance: user.update + walletTransaction.create
    db.user.update.mockResolvedValueOnce({ balanceKopecks: 1000 });
    db.walletTransaction.create.mockResolvedValueOnce({ id: 'wt-1', kind: 'topup', amount: 1000 });
    db.charge.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'c-1',
      amountKopecks: 3000,
      paidKopecks: 2000,
      status: 'refunded',
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/charges/c-1/refund',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balanceKopecks).toBe(1000);
    expect(body.transaction.id).toBe('wt-1');
    expect(body.charge.status).toBe('refunded');
    // Уменьшили уплату ровно на сумму возврата, с фильтром-гардом идемпотентности.
    expect(db.charge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1', status: { not: 'refunded' }, paidKopecks: { gte: 1000 } },
        data: { paidKopecks: { decrement: 1000 }, status: 'refunded' },
      }),
    );
    // Пополнение баланса с note='Возврат' и привязкой к начислению.
    expect(db.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'topup', note: 'Возврат', chargeId: 'c-1' }),
      }),
    );
  });

  it('409 — гонка: updateMany не затронул строк (уже возвращено)', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' });
    db.charge.findUnique.mockResolvedValueOnce({
      id: 'c-1',
      userId: 's-1',
      paidKopecks: 3000,
      status: 'paid',
    });
    mockTxCallback();
    db.charge.updateMany.mockResolvedValueOnce({ count: 0 });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/charges/c-1/refund',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 1000 },
    });

    expect(res.statusCode).toBe(409);
    // Баланс не трогали.
    expect(db.walletTransaction.create).not.toHaveBeenCalled();
  });
});

// ─── approve: авто-погашение долга при пополнении ─────────────────────────────

describe('POST /admin/topup-requests/:id/approve — авто-погашение долга', () => {
  it('200 — пополнение гасит открытое начисление (settleOutstandingCharges)', async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: 'Админ' });
    mockTxCallback();
    db.topUpRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    db.topUpRequest.findUniqueOrThrow
      .mockResolvedValueOnce({ userId: 's-1' })
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'approved',
        claimedAmountKopecks: 5000,
        creditedAmountKopecks: 5000,
        note: null,
        reviewedAt: new Date(),
        createdAt: new Date(),
      });
    // creditBalance (пополнение 5000 → баланс 5000)
    db.user.update.mockResolvedValueOnce({ balanceKopecks: 5000 });
    db.walletTransaction.create.mockResolvedValueOnce({ id: 'tx-1', kind: 'topup', amount: 5000 });
    db.topUpRequest.update.mockResolvedValueOnce({});
    // settleOutstandingCharges: одно открытое начисление 5000, баланс 5000 → гасим целиком
    db.charge.findMany.mockResolvedValueOnce([
      { id: 'c-1', amountKopecks: 5000, paidKopecks: 0, createdAt: new Date('2026-01-01') },
    ]);
    db.user.findUniqueOrThrow
      .mockResolvedValueOnce({ balanceKopecks: 5000 }) // стартовый баланс в settle
      .mockResolvedValueOnce({ balanceKopecks: 0 }) // после debitBalance внутри settle
      .mockResolvedValueOnce({ balanceKopecks: 0 }); // финальное чтение баланса в approve
    db.user.updateMany.mockResolvedValueOnce({ count: 1 }); // списание в debitBalance
    db.walletTransaction.create.mockResolvedValueOnce({ id: 'tx-2', kind: 'debit', amount: 5000 });
    // increment вернул строку с paidKopecks=5000 (полное погашение) → перевод в paid.
    db.charge.update.mockResolvedValueOnce({ id: 'c-1', amountKopecks: 5000, paidKopecks: 5000 });
    db.charge.updateMany.mockResolvedValueOnce({ count: 1 });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/topup-requests/req-1/approve',
      headers: authHeaders(adminToken),
      payload: { amountKopecks: 5000 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Долг погашен → итоговый баланс 0.
    expect(body.balanceKopecks).toBe(0);
    // paidKopecks увеличен АТОМАРНО через increment.
    expect(db.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paidKopecks: { increment: 5000 } } }),
    );
    // Полное погашение → начисление закрыто (status='paid') условным updateMany.
    expect(db.charge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-1', status: 'open' }, data: { status: 'paid' } }),
    );
  });
});

// ─── Настройки оплаты ─────────────────────────────────────────────────────────

describe('payment-settings', () => {
  it('GET /payment-settings — ленивый upsert + qrUrl без секретов', async () => {
    db.paymentSettings.upsert.mockResolvedValueOnce({
      transferUrl: 'https://pay.example',
      transferPhone: '+79990000000',
      instructions: 'переведите и пришлите скрин',
      qrFileKey: 'payment/qr.png',
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/payment-settings',
      headers: authHeaders(studentToken('s-1')),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transferUrl).toBe('https://pay.example');
    expect(body.qrUrl).toContain('signed.example');
    expect(body.qrFileKey).toBeUndefined();
  });

  it('PUT /admin/payment-settings — upsert с updatedById', async () => {
    db.paymentSettings.upsert.mockResolvedValueOnce({
      transferUrl: null,
      transferPhone: '+79991112233',
      instructions: null,
      qrFileKey: null,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/payment-settings',
      headers: authHeaders(adminToken),
      payload: { transferPhone: '+79991112233' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().transferPhone).toBe('+79991112233');
    const call = db.paymentSettings.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ transferPhone: '+79991112233', updatedById: 'admin-1' });
    expect(res.json().qrUrl).toBeNull();
  });

  it('DELETE /admin/payment-settings/qr — обнуляет qrFileKey', async () => {
    db.paymentSettings.upsert.mockResolvedValueOnce({});
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/payment-settings/qr',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().qrUrl).toBeNull();
    const call = db.paymentSettings.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ qrFileKey: null, updatedById: 'admin-1' });
  });

  it('POST /admin/payment-settings/qr — загрузка QR (image) → qrUrl', async () => {
    db.paymentSettings.upsert.mockResolvedValueOnce({});
    const app = await buildApp();
    const mp = buildMultipart({ fileName: 'qr.png', contentType: 'image/png' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/payment-settings/qr',
      headers: { ...authHeaders(adminToken), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().qrUrl).toContain('signed.example');
    expect(db.paymentSettings.upsert).toHaveBeenCalled();
  });

  it('POST /admin/payment-settings/qr — 400 на не-изображении', async () => {
    const app = await buildApp();
    const mp = buildMultipart({ fileName: 'doc.pdf', contentType: 'application/pdf' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/payment-settings/qr',
      headers: { ...authHeaders(adminToken), ...mp.headers },
      payload: mp.payload,
    });

    expect(res.statusCode).toBe(400);
    expect(db.paymentSettings.upsert).not.toHaveBeenCalled();
  });
});
