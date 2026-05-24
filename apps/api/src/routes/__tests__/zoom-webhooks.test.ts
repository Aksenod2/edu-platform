import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только модели, которые трогает роут вебхука (DB-free).
// Настоящий Prisma реэкспортируем через importActual — он нужен роуту для
// проверки `err instanceof Prisma.PrismaClientKnownRequestError` и тесту дедупа,
// чтобы создать реальный экземпляр ошибки P2002.
vi.mock('@platform/db', async () => {
  const actual = await vi.importActual<typeof import('@platform/db')>('@platform/db');
  return {
    prisma: {
      zoomIntegration: { findUnique: vi.fn() },
      zoomWebhookEvent: { create: vi.fn(), update: vi.fn(() => Promise.resolve({})) },
      session: {
        findFirst: vi.fn(),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
    },
    Prisma: actual.Prisma,
  };
});

// Крипто-секреты подменяем детерминированно: расшифровка отдаёт известный токен,
// ключ шифрования считаем настроенным. Подпись/handshake проверяем НАСТОЯЩИМИ
// функциями verifyZoomSignature/buildUrlValidationResponse (это и есть проверка).
vi.mock('../../lib/crypto.js', () => ({
  decryptSecret: vi.fn(() => SECRET_TOKEN),
  isEncryptionKeySet: vi.fn(() => true),
}));

// Тяжёлую фоновую обработку (скачивание/резюме) мокаем — проверяем только то,
// что роут её ВЫЗЫВАЕТ с правильными аргументами; саму выгрузку покрывают unit-тесты.
vi.mock('../../lib/zoom-recording.js', () => ({
  processRecordingForSession: vi.fn(() => Promise.resolve()),
  processSummaryForSession: vi.fn(() => Promise.resolve()),
  markRecordingPending: vi.fn(() => Promise.resolve()),
}));

// Забор посещаемости (B5) на meeting.ended — мокаем: проверяем, что роут ВЫЗЫВАЕТ
// его с правильными аргументами; саму lib покрывают тесты lesson-attendance.
vi.mock('../../lib/zoom-attendance.js', () => ({
  pullSessionAttendanceFromZoom: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { zoomWebhookRoutes } from '../zoom-webhooks.js';
import { prisma, Prisma } from '@platform/db';
import { decryptSecret, isEncryptionKeySet } from '../../lib/crypto.js';
import {
  processRecordingForSession,
  processSummaryForSession,
  markRecordingPending,
} from '../../lib/zoom-recording.js';
import { pullSessionAttendanceFromZoom } from '../../lib/zoom-attendance.js';

const SECRET_TOKEN = 'whsec_test_token';
const WEBHOOK_ID = 'wh-123';
const TEACHER_USER_ID = 'teacher-1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockDecrypt = vi.mocked(decryptSecret);
const mockKeySet = vi.mocked(isEncryptionKeySet);
const mockProcessRecording = vi.mocked(processRecordingForSession);
const mockProcessSummary = vi.mocked(processSummaryForSession);
const mockMarkPending = vi.mocked(markRecordingPending);
const mockPullAttendance = vi.mocked(pullSessionAttendanceFromZoom);

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(zoomWebhookRoutes);
  return app;
}

// Подписывает сырое тело как это делает Zoom: HMAC-SHA256 от `v0:${ts}:${rawBody}`.
function signBody(rawBody: string, ts: string): string {
  const hash = createHmac('sha256', SECRET_TOKEN).update(`v0:${ts}:${rawBody}`).digest('hex');
  return `v0=${hash}`;
}

function nowTs(): string {
  return String(Date.now());
}

function integration() {
  return {
    userId: TEACHER_USER_ID,
    secretTokenEnc: 'enc:enc:enc',
    webhookId: WEBHOOK_ID,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDecrypt.mockReturnValue(SECRET_TOKEN);
  mockKeySet.mockReturnValue(true);
  // По умолчанию интеграция найдена; вставка события успешна (не дубликат).
  db.zoomIntegration.findUnique.mockResolvedValue(integration());
  db.zoomWebhookEvent.create.mockResolvedValue({ id: 'evt-1' });
  db.zoomWebhookEvent.update.mockResolvedValue({});
  db.session.findFirst.mockResolvedValue(null);
  db.session.updateMany.mockResolvedValue({ count: 1 });
});

describe('POST /webhooks/zoom/:webhookId — интеграция и конфиг', () => {
  it('нет интеграции по webhookId → 404', async () => {
    db.zoomIntegration.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/zoom/unknown',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'meeting.started' }),
    });
    expect(res.statusCode).toBe(404);
  });

  // M5: «не настроен» отвечает ТАК ЖЕ, как «не найден» (404 с тем же телом) —
  // снаружи случаи неразличимы, чтобы не давать оракул перебора webhookId.
  it('нет секрет-токена/ключа шифрования → 404, как и при отсутствии интеграции', async () => {
    // Эталон ответа для несуществующего webhookId.
    db.zoomIntegration.findUnique.mockResolvedValue(null);
    const notFoundApp = buildApp();
    const notFoundRes = await notFoundApp.inject({
      method: 'POST',
      url: '/webhooks/zoom/unknown',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'meeting.started' }),
    });

    // «Не настроен»: интеграция есть, но секрет-токена нет.
    db.zoomIntegration.findUnique.mockResolvedValue({ ...integration(), secretTokenEnc: null });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'meeting.started' }),
    });

    expect(res.statusCode).toBe(404);
    // Тело и статус совпадают с «не найден» → неразличимо для перебора.
    expect(res.statusCode).toBe(notFoundRes.statusCode);
    expect(res.json()).toEqual(notFoundRes.json());
  });
});

describe('POST /webhooks/zoom/:webhookId — handshake url_validation', () => {
  it('endpoint.url_validation → 200 c корректным encryptedToken (без проверки подписи)', async () => {
    const plainToken = 'pt-abc';
    const body = JSON.stringify({
      event: 'endpoint.url_validation',
      payload: { plainToken },
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: { 'content-type': 'application/json' },
      // Намеренно БЕЗ заголовков подписи — handshake не должен их требовать.
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as { plainToken: string; encryptedToken: string };
    expect(json.plainToken).toBe(plainToken);
    const expected = createHmac('sha256', SECRET_TOKEN).update(plainToken).digest('hex');
    expect(json.encryptedToken).toBe(expected);
    // Событие НЕ должно записываться (handshake не идёт в дедуп/обработку).
    expect(db.zoomWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('url_validation без plainToken → 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'endpoint.url_validation', payload: {} }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /webhooks/zoom/:webhookId — проверка подписи', () => {
  it('валидная подпись → 200 accepted + событие записано', async () => {
    const ts = nowTs();
    const body = JSON.stringify({
      event: 'meeting.started',
      payload: { object: { id: 999 } },
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'accepted' });
    expect(db.zoomWebhookEvent.create).toHaveBeenCalledTimes(1);
  });

  it('неверная подпись → 401, событие НЕ записано', async () => {
    const ts = nowTs();
    const body = JSON.stringify({ event: 'meeting.started', payload: { object: { id: 1 } } });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': 'v0=deadbeef',
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(db.zoomWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('отсутствуют заголовки подписи → 401', async () => {
    const body = JSON.stringify({ event: 'meeting.started' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('просроченный timestamp (replay) → 401, даже с валидной по содержимому подписью', async () => {
    // Таймстемп старше окна (5 минут) — подпись валидна для этого ts, но отбивается.
    const oldTs = String(Date.now() - 10 * 60 * 1000);
    const body = JSON.stringify({ event: 'meeting.started' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, oldTs),
        'x-zm-request-timestamp': oldTs,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(db.zoomWebhookEvent.create).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/zoom/:webhookId — идемпотентность (дедуп)', () => {
  it('повторное событие (P2002) → 200 duplicate, без обработки', async () => {
    db.zoomWebhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const ts = nowTs();
    const body = JSON.stringify({
      event: 'recording.completed',
      payload: { object: { id: 555 } },
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'duplicate' });
    // Дубликат не должен запускать фоновую обработку.
    expect(mockProcessRecording).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/zoom/:webhookId — маршрутизация к Session', () => {
  it('meeting.started → переводит занятие из planned в live (только из planned)', async () => {
    db.session.findFirst.mockResolvedValue({
      id: 'sess-live',
      streamId: 'stream-1',
      zoomMeetingId: '777',
    });

    const ts = nowTs();
    const body = JSON.stringify({ event: 'meeting.started', payload: { object: { id: 777 } } });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(db.session.findFirst).toHaveBeenCalledWith({
      where: { zoomMeetingId: '777' },
      select: { id: true, streamId: true, zoomMeetingId: true },
    });
    // Перевод в live строго из 'planned' (не трогает done/cancelled/draft).
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-live', status: 'planned' },
      data: { status: 'live' },
    });
    // meeting.started не качает запись, не собирает резюме, не помечает pending.
    expect(mockProcessRecording).not.toHaveBeenCalled();
    expect(mockProcessSummary).not.toHaveBeenCalled();
    expect(mockMarkPending).not.toHaveBeenCalled();
  });

  it('meeting.started идемпотентен: updateMany count=0 (статус уже не planned) не ломает обработку', async () => {
    db.session.findFirst.mockResolvedValue({
      id: 'sess-done',
      streamId: 'stream-1',
      zoomMeetingId: '778',
    });
    // Занятие уже done/cancelled — условие status='planned' не совпадёт.
    db.session.updateMany.mockResolvedValue({ count: 0 });

    const ts = nowTs();
    const body = JSON.stringify({ event: 'meeting.started', payload: { object: { id: 778 } } });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-done', status: 'planned' },
      data: { status: 'live' },
    });
    // Событие всё равно помечается обработанным (count=0 не ошибка).
    expect(db.zoomWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { status: 'processed', processedAt: expect.any(Date) },
    });
  });

  it('recording.completed → находит Session по zoomMeetingId и вызывает обработку', async () => {
    db.session.findFirst.mockResolvedValue({ id: 'sess-77' });

    const ts = nowTs();
    const recordingFiles = [
      { file_type: 'MP4', recording_type: 'shared_screen_with_speaker_view', download_url: 'https://z/x' },
    ];
    const body = JSON.stringify({
      event: 'recording.completed',
      payload: { object: { id: 12345, recording_files: recordingFiles } },
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    // Фоновая обработка fire-and-forget — дожидаемся микротасков.
    await new Promise((r) => setImmediate(r));

    expect(db.session.findFirst).toHaveBeenCalledWith({
      where: { zoomMeetingId: '12345' },
      select: { id: true, streamId: true, zoomMeetingId: true },
    });
    expect(mockProcessRecording).toHaveBeenCalledTimes(1);
    const arg = mockProcessRecording.mock.calls[0][0];
    expect(arg.sessionId).toBe('sess-77');
    expect(arg.meetingId).toBe('12345');
    expect(arg.teacherUserId).toBe(TEACHER_USER_ID);
    expect(arg.payloadFiles).toEqual(recordingFiles);
    expect(mockProcessSummary).not.toHaveBeenCalled();
  });

  it('meeting.summary_completed → вызывает обработку резюме для найденной Session', async () => {
    db.session.findFirst.mockResolvedValue({ id: 'sess-88' });

    const ts = nowTs();
    const body = JSON.stringify({
      event: 'meeting.summary_completed',
      payload: {
        object: { id: 42, summary_overview: 'Краткий обзор', summary_details: [] },
      },
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(mockProcessSummary).toHaveBeenCalledTimes(1);
    expect(mockProcessSummary.mock.calls[0][0].sessionId).toBe('sess-88');
    expect(mockProcessRecording).not.toHaveBeenCalled();
  });

  it('meeting.ended → помечает запись pending и запускает забор посещаемости', async () => {
    db.session.findFirst.mockResolvedValue({
      id: 'sess-99',
      streamId: 'stream-99',
      zoomMeetingId: '333',
    });

    const ts = nowTs();
    const body = JSON.stringify({
      event: 'meeting.ended',
      payload: { object: { id: 333 } },
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(db.session.findFirst).toHaveBeenCalledWith({
      where: { zoomMeetingId: '333' },
      select: { id: true, streamId: true, zoomMeetingId: true },
    });
    expect(mockMarkPending).toHaveBeenCalledTimes(1);
    expect(mockMarkPending.mock.calls[0][0]).toEqual({ sessionId: 'sess-99' });
    // meeting.ended также запускает забор посещаемости из Zoom (best-effort).
    expect(mockPullAttendance).toHaveBeenCalledTimes(1);
    expect(mockPullAttendance.mock.calls[0][1]).toEqual({
      id: 'sess-99',
      streamId: 'stream-99',
      zoomMeetingId: '333',
    });
    // meeting.ended не качает запись и не собирает резюме.
    expect(mockProcessRecording).not.toHaveBeenCalled();
    expect(mockProcessSummary).not.toHaveBeenCalled();

    // meeting.ended авто-переводит занятие в 'done' из 'planned' ИЛИ 'live'
    // (атомарно через updateMany с условием status IN ('planned','live')).
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-99', status: { in: ['planned', 'live'] } },
      data: { status: 'done' },
    });
  });

  it('meeting.ended авто-done идемпотентен: updateMany count=0 (статус уже не planned) не ломает обработку', async () => {
    db.session.findFirst.mockResolvedValue({
      id: 'sess-cancelled',
      streamId: 'stream-1',
      zoomMeetingId: '444',
    });
    // Занятие уже отменено/завершено — условие status='planned' не совпадёт,
    // updateMany затронет 0 строк (его where и защищает 'cancelled'/'done').
    db.session.updateMany.mockResolvedValue({ count: 0 });

    const ts = nowTs();
    const body = JSON.stringify({ event: 'meeting.ended', payload: { object: { id: 444 } } });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));

    // Запрос на авто-done всё равно делается, но с условием planned/live —
    // отменённое занятие (status не входит в набор) останется нетронутым.
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sess-cancelled', status: { in: ['planned', 'live'] } },
      data: { status: 'done' },
    });
    // Событие всё равно помечается обработанным (count=0 не считается ошибкой).
    expect(db.zoomWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { status: 'processed', processedAt: expect.any(Date) },
    });
  });

  it('recording.completed без подходящей Session → 200, обработка не запускается', async () => {
    db.session.findFirst.mockResolvedValue(null);

    const ts = nowTs();
    const body = JSON.stringify({
      event: 'recording.completed',
      payload: { object: { id: 7 } },
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/zoom/${WEBHOOK_ID}`,
      headers: {
        'content-type': 'application/json',
        'x-zm-signature': signBody(body, ts),
        'x-zm-request-timestamp': ts,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(mockProcessRecording).not.toHaveBeenCalled();
  });
});
