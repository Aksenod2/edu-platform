import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогает GET /lessons/:id/analytics (DB-free).
// Занятие = Session(streamId × lessonId); знаменатель — StreamEnrollment.count;
// распределение по статусам — studentAssignment.groupBy.
vi.mock('@platform/db', () => ({
  prisma: {
    lesson: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    stream: { findUnique: vi.fn() },
    session: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    streamEnrollment: { count: vi.fn(), findMany: vi.fn() },
    studentAssignment: { groupBy: vi.fn() },
    lessonVideo: { findMany: vi.fn() },
    programLesson: { findMany: vi.fn() },
    lessonTeacher: { findMany: vi.fn() },
  },
  // Prisma re-export — в lessons.ts используется как тип/значение namespace.
  Prisma: {},
}));

// Уведомления — no-op.
vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

// S3 — no-op (подпись ссылок не нужна для аналитики).
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
}));

// Zoom — no-op (не задействован в аналитике).
vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(() => Promise.resolve(false)),
  canCreateMeeting: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('../../lib/zoom-recording.js', () => ({
  processRecordingForSession: vi.fn(() => Promise.resolve()),
}));

import { lessonRoutes } from '../lessons.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(lessonRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });
const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /lessons/:id/analytics — аналитика сдач по занятию', () => {
  it('admin: 200 с плоскими счётчиками по статусам', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-1' });
    db.streamEnrollment.count.mockResolvedValueOnce(10);
    db.studentAssignment.groupBy.mockResolvedValueOnce([
      { status: 'assigned', _count: { _all: 3 } },
      { status: 'submitted', _count: { _all: 2 } },
      { status: 'reviewed', _count: { _all: 4 } },
      { status: 'needs_revision', _count: { _all: 1 } },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/analytics?streamId=stream-1',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sessionId: 'session-1',
      streamId: 'stream-1',
      enrolledCount: 10,
      total: 10, // 3+2+4+1
      byStatus: { assigned: 3, submitted: 2, reviewed: 4, needs_revision: 1 },
      submittedCount: 7, // 2+4+1 (submitted+reviewed+needs_revision)
      notSubmittedCount: 3, // 10 - 7
      pendingReviewCount: 2, // submitted
    });

    // Session ищется строго по паре (streamId, lessonId).
    expect(db.session.findUnique).toHaveBeenCalledTimes(1);
    expect(db.session.findUnique.mock.calls[0][0].where).toEqual({
      streamId_lessonId: { streamId: 'stream-1', lessonId: 'lesson-1' },
    });
    // groupBy считает по sessionId найденного занятия.
    expect(db.studentAssignment.groupBy.mock.calls[0][0].where).toEqual({
      sessionId: 'session-1',
    });
    // Знаменатель (состав потока) считается БЕЗ демо/служебных аккаунтов (User.isDemo).
    expect(db.streamEnrollment.count.mock.calls[0][0].where).toEqual({
      streamId: 'stream-1',
      user: { isDemo: false },
    });
  });

  it('admin: enrolledCount без демо/служебных — знаменатель и notSubmittedCount не завышаются', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-3' });
    // В потоке 5 зачислений, из них 2 демо → не-демо знаменатель = 3 (мок count уже
    // отфильтрован фильтром user.isDemo=false, который мы и проверяем).
    db.streamEnrollment.count.mockResolvedValueOnce(3);
    db.studentAssignment.groupBy.mockResolvedValueOnce([
      { status: 'reviewed', _count: { _all: 1 } },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-3/analytics?streamId=stream-3',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enrolledCount).toBe(3);
    // submittedCount=1 (reviewed); не сдали = 3-1 = 2 (а не 5-1).
    expect(body.notSubmittedCount).toBe(2);
    // count вызван с relation-фильтром на не-демо студентов.
    expect(db.streamEnrollment.count).toHaveBeenCalledWith({
      where: { streamId: 'stream-3', user: { isDemo: false } },
    });
  });

  it('admin: отсутствующие статусы дают 0, notSubmittedCount не уходит в минус', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-2' });
    db.streamEnrollment.count.mockResolvedValueOnce(2);
    // Все сдали и проверены — материализованных назначений больше, чем enrolled
    // (например, кого-то отчислили из потока). notSubmittedCount не должен быть < 0.
    db.studentAssignment.groupBy.mockResolvedValueOnce([
      { status: 'reviewed', _count: { _all: 5 } },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-2/analytics?streamId=stream-2',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.byStatus).toEqual({ assigned: 0, submitted: 0, reviewed: 5, needs_revision: 0 });
    expect(body.total).toBe(5);
    expect(body.submittedCount).toBe(5);
    expect(body.notSubmittedCount).toBe(0); // max(0, 2-5)
    expect(body.pendingReviewCount).toBe(0);
  });

  it('admin: 404 если занятия (Session) нет', async () => {
    db.session.findUnique.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-x/analytics?streamId=stream-x',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Занятие не найдено' });
    expect(db.streamEnrollment.count).not.toHaveBeenCalled();
    expect(db.studentAssignment.groupBy).not.toHaveBeenCalled();
  });

  it('admin: 400 без streamId', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/analytics',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(400);
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });

  it('требует роль admin: студент → 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/analytics?streamId=stream-1',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });

  it('требует аутентификацию: без токена → 401', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/analytics?streamId=stream-1',
    });

    expect(res.statusCode).toBe(401);
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });
});
