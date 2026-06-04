import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогает POST .../materials/access (DB-free).
vi.mock('@platform/db', () => {
  class FakeKnownRequestError extends Error {
    code: string;
    constructor(message: string, meta: { code: string; clientVersion: string }) {
      super(message);
      this.code = meta.code;
    }
  }
  return {
    prisma: {
      lesson: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      stream: { findUnique: vi.fn() },
      session: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
      streamEnrollment: { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn() },
      studentAssignment: { groupBy: vi.fn() },
      lessonVideo: { findFirst: vi.fn(), findMany: vi.fn() },
      videoView: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      materialAccess: { create: vi.fn() },
      programLesson: { findMany: vi.fn() },
      lessonTeacher: { findMany: vi.fn() },
      $transaction: vi.fn(),
    },
    Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError },
  };
});

// Уведомления — no-op.
vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

// S3 — no-op.
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
}));

// Zoom — no-op.
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

const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

const URL = '/lessons/lesson-1/materials/access';

function post(app: FastifyInstance, body: Record<string, unknown>, token = studentToken) {
  return app.inject({ method: 'POST', url: URL, headers: authHeaders(token), payload: body });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /lessons/:id/materials/access — приём обращения к материалу', () => {
  it('401 без токена', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: { streamId: 's1', s3Key: 'k1', accessType: 'viewed' },
    });
    expect(res.statusCode).toBe(401);
    expect(db.lesson.findUnique).not.toHaveBeenCalled();
  });

  it('400 при некорректном accessType', async () => {
    const app = buildApp();
    const res = await post(app, { streamId: 's1', s3Key: 'k1', accessType: 'opened' });
    expect(res.statusCode).toBe(400);
    expect(db.lesson.findUnique).not.toHaveBeenCalled();
  });

  it('400 без streamId', async () => {
    const app = buildApp();
    const res = await post(app, { s3Key: 'k1', accessType: 'viewed' });
    expect(res.statusCode).toBe(400);
  });

  it('400 без s3Key', async () => {
    const app = buildApp();
    const res = await post(app, { streamId: 's1', accessType: 'viewed' });
    expect(res.statusCode).toBe(400);
  });

  it('404 для несуществующего урока', async () => {
    db.lesson.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await post(app, { streamId: 's1', s3Key: 'k1', accessType: 'viewed' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Урок не найден' });
  });

  it('404 для чужого s3Key (нет среди материалов урока)', async () => {
    db.lesson.findUnique.mockResolvedValueOnce({
      id: 'lesson-1',
      materials: [{ s3Key: 'own-key', fileName: 'конспект.pdf' }],
      assignmentMaterials: [],
    });
    const app = buildApp();
    const res = await post(app, { streamId: 's1', s3Key: 'чужой-ключ', accessType: 'viewed' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Материал не найден' });
    expect(db.materialAccess.create).not.toHaveBeenCalled();
  });

  it('403 для не зачисленного студента', async () => {
    db.lesson.findUnique.mockResolvedValueOnce({
      id: 'lesson-1',
      materials: [{ s3Key: 'k1', fileName: 'конспект.pdf' }],
      assignmentMaterials: [],
    });
    db.streamEnrollment.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await post(app, { streamId: 's1', s3Key: 'k1', accessType: 'viewed' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Вы не зачислены в эту группу' });
    expect(db.materialAccess.create).not.toHaveBeenCalled();
  });

  it('happy-path: материал из materials — создаёт строку со снимком имени (fileName)', async () => {
    db.lesson.findUnique.mockResolvedValueOnce({
      id: 'lesson-1',
      materials: [{ s3Key: 'k1', fileName: 'конспект.pdf' }],
      assignmentMaterials: [],
    });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.materialAccess.create.mockResolvedValueOnce({ id: 'ma-1' });

    const app = buildApp();
    const res = await post(app, { streamId: 's1', s3Key: 'k1', accessType: 'downloaded' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.materialAccess.create).toHaveBeenCalledTimes(1);
    expect(db.materialAccess.create.mock.calls[0][0].data).toEqual({
      studentId: 'stu-1',
      lessonId: 'lesson-1',
      streamId: 's1',
      s3Key: 'k1',
      fileName: 'конспект.pdf',
      accessType: 'downloaded',
    });
  });

  it('happy-path: материал из assignmentMaterials — имя берётся из .name', async () => {
    db.lesson.findUnique.mockResolvedValueOnce({
      id: 'lesson-1',
      materials: [],
      assignmentMaterials: [
        { type: 'url', url: 'https://example.com' }, // без s3Key — пропускаем
        { type: 'file', s3Key: 'a1', name: 'задание.docx' },
      ],
    });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.materialAccess.create.mockResolvedValueOnce({ id: 'ma-2' });

    const app = buildApp();
    const res = await post(app, { streamId: 's1', s3Key: 'a1', accessType: 'viewed' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.materialAccess.create.mock.calls[0][0].data).toMatchObject({
      s3Key: 'a1',
      fileName: 'задание.docx',
      accessType: 'viewed',
    });
  });
});
