import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые вызывает telegramIntegrationRoutes (DB-free).
vi.mock('@platform/db', () => ({
  prisma: {
    telegramIntegration: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    // authenticate() для JWT-токена prisma не трогает (apiKey только для sk_-токенов).
    apiKey: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

// Крипто детерминированно: шифрование префиксует, расшифровка снимает префикс,
// ключ настроен. Это позволяет проверить, что НЕ шифрованный токен наружу не уходит.
vi.mock('../../lib/crypto.js', () => ({
  encryptSecret: vi.fn((plain: string) => `enc(${plain})`),
  decryptSecret: vi.fn((enc: string) => enc.replace(/^enc\(/, '').replace(/\)$/, '')),
  isEncryptionKeySet: vi.fn(() => true),
}));

// Telegram-клиент мокаем целиком — сеть не трогаем.
vi.mock('../../lib/telegram.js', () => ({
  getBotInfo: vi.fn(),
  fetchChatIdFromUpdates: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));

import { telegramIntegrationRoutes } from '../telegram-integrations.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import { isEncryptionKeySet } from '../../lib/crypto.js';
import { getBotInfo, fetchChatIdFromUpdates, sendTelegramMessage } from '../../lib/telegram.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockKeySet = vi.mocked(isEncryptionKeySet);
const mockGetBotInfo = vi.mocked(getBotInfo);
const mockFetchChatId = vi.mocked(fetchChatIdFromUpdates);
const mockSend = vi.mocked(sendTelegramMessage);

const USER_ID = 'admin-1';
const adminToken = signAccessToken({ userId: USER_ID, role: 'admin' });
const studentToken = signAccessToken({ userId: 's-1', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(telegramIntegrationRoutes);
  return app;
}

// Полная запись интеграции (с привязкой) для удобства.
function fullIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ti-1',
    userId: USER_ID,
    enabled: true,
    botTokenEnc: 'enc(123:ABC)',
    botUsername: 'my_bot',
    chatId: '555',
    linkedAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T09:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockKeySet.mockReturnValue(true);
});

describe('защита роли', () => {
  it('GET без admin → 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/integrations/telegram',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET без токена → 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/admin/integrations/telegram' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /admin/integrations/telegram', () => {
  it('нет записи → дефолтное состояние (enabled:true, ничего не настроено)', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/integrations/telegram',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tokenSet: false,
      botUsername: null,
      connected: false,
      enabled: true,
      linkedAt: null,
      encryptionKeySet: true,
    });
  });

  it('полная запись → отражает состояние и НЕ светит секреты', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(fullIntegration());
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/integrations/telegram',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toEqual({
      tokenSet: true,
      botUsername: 'my_bot',
      connected: true,
      enabled: true,
      linkedAt: '2026-06-01T10:00:00.000Z',
      encryptionKeySet: true,
    });
    // Ни токена (ни зашифрованного), ни chatId наружу.
    const raw = res.body;
    expect(raw).not.toContain('botTokenEnc');
    expect(raw).not.toContain('enc(');
    expect(raw).not.toContain('chatId');
    expect(raw).not.toContain('555');
  });

  it('encryptionKeySet=false отражается в ответе', async () => {
    mockKeySet.mockReturnValue(false);
    db.telegramIntegration.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/integrations/telegram',
      headers: authHeaders(adminToken),
    });
    expect(res.json().encryptionKeySet).toBe(false);
  });
});

describe('PUT /admin/integrations/telegram/token', () => {
  it('пустой токен → 400, без обращения к Telegram', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/integrations/telegram/token',
      headers: authHeaders(adminToken),
      payload: { botToken: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockGetBotInfo).not.toHaveBeenCalled();
  });

  it('нет ключа шифрования → 400', async () => {
    mockKeySet.mockReturnValue(false);
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/integrations/telegram/token',
      headers: authHeaders(adminToken),
      payload: { botToken: '123:ABC' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Не настроен ключ шифрования');
    expect(mockGetBotInfo).not.toHaveBeenCalled();
  });

  it('невалидный токен (getMe → null) → 400, upsert не вызван', async () => {
    mockGetBotInfo.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/integrations/telegram/token',
      headers: authHeaders(adminToken),
      payload: { botToken: 'bad-token' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Неверный токен бота');
    expect(db.telegramIntegration.upsert).not.toHaveBeenCalled();
  });

  it('валидный токен → шифруется, сохраняется username, сбрасывает привязку', async () => {
    mockGetBotInfo.mockResolvedValue({ username: 'my_bot' });
    db.telegramIntegration.upsert.mockResolvedValue(
      fullIntegration({ botTokenEnc: 'enc(123:ABC)', chatId: null, linkedAt: null }),
    );
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/integrations/telegram/token',
      headers: authHeaders(adminToken),
      payload: { botToken: '123:ABC' },
    });
    expect(res.statusCode).toBe(200);

    // Токен сохранён ЗАШИФРОВАННЫМ; при смене токена chatId/linkedAt сброшены.
    const call = db.telegramIntegration.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: USER_ID });
    expect(call.update.botTokenEnc).toBe('enc(123:ABC)');
    expect(call.update.botUsername).toBe('my_bot');
    expect(call.update.chatId).toBeNull();
    expect(call.update.linkedAt).toBeNull();
    expect(call.create.botTokenEnc).toBe('enc(123:ABC)');

    // Ответ — публичный вид, без сырого токена.
    const json = res.json();
    expect(json.tokenSet).toBe(true);
    expect(json.connected).toBe(false);
    expect(res.body).not.toContain('123:ABC');
  });
});

describe('POST /admin/integrations/telegram/link', () => {
  it('нет токена → 400 «Сначала сохраните токен»', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/integrations/telegram/link',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Сначала сохраните токен');
    expect(mockFetchChatId).not.toHaveBeenCalled();
  });

  it('нет апдейтов (fetchChatIdFromUpdates → null) → 409', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(
      fullIntegration({ chatId: null, linkedAt: null }),
    );
    mockFetchChatId.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/integrations/telegram/link',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(
      'Не нашли сообщений боту. Откройте бота, нажмите Старт и повторите.',
    );
    expect(db.telegramIntegration.update).not.toHaveBeenCalled();
  });

  it('есть апдейты → сохраняет chatId + linkedAt, connected:true', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(
      fullIntegration({ chatId: null, linkedAt: null }),
    );
    mockFetchChatId.mockResolvedValue('98765');
    db.telegramIntegration.update.mockResolvedValue(fullIntegration({ chatId: '98765' }));
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/integrations/telegram/link',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);

    // Расшифрованный токен передан в fetchChatIdFromUpdates.
    expect(mockFetchChatId).toHaveBeenCalledWith('123:ABC');

    const call = db.telegramIntegration.update.mock.calls[0][0];
    expect(call.where).toEqual({ userId: USER_ID });
    expect(call.data.chatId).toBe('98765');
    expect(call.data.linkedAt).toBeInstanceOf(Date);

    expect(res.json().connected).toBe(true);
    expect(res.body).not.toContain('98765');
  });
});

describe('POST /admin/integrations/telegram/test', () => {
  it('не настроен токен → 400', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/integrations/telegram/test',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('не привязан чат → 400', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(
      fullIntegration({ chatId: null, linkedAt: null }),
    );
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/integrations/telegram/test',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('настроено → отправляет тестовое и возвращает ok', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(fullIntegration());
    mockSend.mockResolvedValue(true);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/integrations/telegram/test',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledWith('123:ABC', '555', expect.any(String));
  });

  it('sendTelegramMessage вернул false → ok:false (без 500)', async () => {
    db.telegramIntegration.findUnique.mockResolvedValue(fullIntegration());
    mockSend.mockResolvedValue(false);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/integrations/telegram/test',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false });
  });
});

describe('PATCH /admin/integrations/telegram', () => {
  it('не-boolean → 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/integrations/telegram',
      headers: authHeaders(adminToken),
      payload: { enabled: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.telegramIntegration.upsert).not.toHaveBeenCalled();
  });

  it('enabled:false → upsert и отражает в ответе', async () => {
    db.telegramIntegration.upsert.mockResolvedValue(fullIntegration({ enabled: false }));
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/integrations/telegram',
      headers: authHeaders(adminToken),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect(db.telegramIntegration.upsert.mock.calls[0][0].update).toEqual({ enabled: false });
  });
});

describe('DELETE /admin/integrations/telegram', () => {
  it('чистит токен/username/chatId/linkedAt, оставляет enabled', async () => {
    db.telegramIntegration.updateMany.mockResolvedValue({ count: 1 });
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/integrations/telegram',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const call = db.telegramIntegration.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: USER_ID });
    expect(call.data).toEqual({
      botTokenEnc: null,
      botUsername: null,
      chatId: null,
      linkedAt: null,
    });
    // enabled не трогаем.
    expect(call.data).not.toHaveProperty('enabled');
  });
});
