import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогает POST .../progress (DB-free).
// Класс-заглушку для ветки ретрая (P2002) определяем ВНУТРИ фабрики — vi.mock
// хойстится в начало файла, top-level переменные в нём недоступны.
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
      programLesson: { findMany: vi.fn() },
      lessonTeacher: { findMany: vi.fn() },
      // Транзакция: вызываем колбэк с тем же объектом prisma (tx === prisma в моках).
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
import { prisma, Prisma } from '@platform/db';
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

const URL = '/lessons/lesson-1/videos/video-1/progress';

function post(app: FastifyInstance, body: Record<string, unknown>, token = studentToken) {
  return app.inject({
    method: 'POST',
    url: URL,
    headers: authHeaders(token),
    payload: body,
  });
}

// $transaction(callback) → callback(prisma): tx делит те же моки, что и prisma.
function wireTransaction() {
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
}

beforeEach(() => {
  vi.clearAllMocks();
  wireTransaction();
});

describe('POST /lessons/:id/videos/:videoId/progress — приём прогресса просмотра', () => {
  it('401 без токена', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: { streamId: 's1', positionSec: 1, durationSec: 100, intervals: [] },
    });
    expect(res.statusCode).toBe(401);
    expect(db.lessonVideo.findFirst).not.toHaveBeenCalled();
  });

  it('400 при durationSec <= 0', async () => {
    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 0,
      durationSec: 0,
      intervals: [],
    });
    expect(res.statusCode).toBe(400);
    expect(db.lessonVideo.findFirst).not.toHaveBeenCalled();
  });

  it('400 без streamId', async () => {
    const app = buildApp();
    const res = await post(app, { positionSec: 0, durationSec: 100, intervals: [] });
    expect(res.statusCode).toBe(400);
  });

  it('400 при отрицательном positionSec', async () => {
    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: -5,
      durationSec: 100,
      intervals: [],
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 для чужого/несуществующего видео', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 10,
      durationSec: 100,
      intervals: [[0, 10]],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Видео не найдено' });
    // findFirst ищет по паре (id видео, lessonId).
    expect(db.lessonVideo.findFirst.mock.calls[0][0].where).toEqual({
      id: 'video-1',
      lessonId: 'lesson-1',
    });
  });

  it('400 для внешнего видео (videoKey == null)', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: null });
    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 10,
      durationSec: 100,
      intervals: [[0, 10]],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Внешнее видео не отслеживается' });
  });

  it('404 для несуществующего потока', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: 'key-1' });
    db.stream.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await post(app, {
      streamId: 's-x',
      positionSec: 10,
      durationSec: 100,
      intervals: [[0, 10]],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Группа не найдена' });
  });

  it('403 для не зачисленного студента', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: 'key-1' });
    db.stream.findUnique.mockResolvedValueOnce({ id: 's1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 10,
      durationSec: 100,
      intervals: [[0, 10]],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Вы не зачислены в эту группу' });
    expect(db.videoView.create).not.toHaveBeenCalled();
  });

  it('happy-path: создаёт ряд и возвращает прогресс', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: 'key-1' });
    db.stream.findUnique.mockResolvedValueOnce({ id: 's1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.videoView.findUnique.mockResolvedValueOnce(null); // ряда ещё нет
    db.videoView.create.mockResolvedValueOnce({ id: 'vv-1' });

    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 50,
      durationSec: 100,
      intervals: [[0, 50]],
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      watchedPercent: 50,
      watchedSec: 50,
      lastPositionSec: 50,
      completed: false,
    });

    // Создание ряда по тройке (studentId из токена, lessonVideoId, streamId).
    expect(db.videoView.create).toHaveBeenCalledTimes(1);
    const created = db.videoView.create.mock.calls[0][0].data;
    expect(created.studentId).toBe('stu-1');
    expect(created.lessonVideoId).toBe('video-1');
    expect(created.streamId).toBe('s1');
    expect(created.watchedSec).toBe(50);
    expect(created.watchedPercent).toBe(50);
    expect(created.lastPositionSec).toBe(50);
    expect(created.durationSec).toBe(100);
    expect(created.watchedIntervals).toEqual([[0, 50]]);
    expect(created.sessionsCount).toBe(1);
    expect(created.completedAt).toBeUndefined(); // < 90%
  });

  it('идемпотентный повтор тех же интервалов: watchedSec стабилен', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: 'key-1' });
    db.stream.findUnique.mockResolvedValueOnce({ id: 's1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    // Ряд уже есть с интервалом [0,50].
    db.videoView.findUnique.mockResolvedValueOnce({
      id: 'vv-1',
      watchedIntervals: [[0, 50]],
      completedAt: null,
    });
    db.videoView.update.mockResolvedValueOnce({ id: 'vv-1' });

    const app = buildApp();
    // Шлём те же [0,50] заново.
    const res = await post(app, {
      streamId: 's1',
      positionSec: 50,
      durationSec: 100,
      intervals: [[0, 50]],
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      watchedPercent: 50,
      watchedSec: 50, // не вырос
      lastPositionSec: 50,
      completed: false,
    });
    expect(db.videoView.update).toHaveBeenCalledTimes(1);
    const upd = db.videoView.update.mock.calls[0][0].data;
    expect(upd.watchedSec).toBe(50);
    expect(upd.watchedIntervals).toEqual([[0, 50]]);
    // totalPlayedSec инкрементится сырым временем (с повтором) — задел Ур.2.
    expect(upd.totalPlayedSec).toEqual({ increment: 50 });
  });

  it('completed=true и проставление completedAt при достижении 90%', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: 'key-1' });
    db.stream.findUnique.mockResolvedValueOnce({ id: 's1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.videoView.findUnique.mockResolvedValueOnce({
      id: 'vv-1',
      watchedIntervals: [[0, 80]],
      completedAt: null,
    });
    db.videoView.update.mockResolvedValueOnce({ id: 'vv-1' });

    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 95,
      durationSec: 100,
      intervals: [[80, 95]], // итого [0,95] = 95%
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watchedPercent).toBe(95);
    expect(body.completed).toBe(true);
    const upd = db.videoView.update.mock.calls[0][0].data;
    expect(upd.completedAt).toBeInstanceOf(Date);
  });

  it('перемотка в конец без просмотра ≠ 100%', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: 'key-1' });
    db.stream.findUnique.mockResolvedValueOnce({ id: 's1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.videoView.findUnique.mockResolvedValueOnce(null);
    db.videoView.create.mockResolvedValueOnce({ id: 'vv-1' });

    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 100,
      durationSec: 100,
      intervals: [[99, 100]],
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watchedPercent).toBe(1);
    expect(body.completed).toBe(false);
  });

  it('ретрай при коллизии уникального индекса (P2002)', async () => {
    db.lessonVideo.findFirst.mockResolvedValueOnce({ id: 'video-1', videoKey: 'key-1' });
    db.stream.findUnique.mockResolvedValueOnce({ id: 's1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });

    // Первый прогон транзакции бросает P2002 (гонка на create), второй — успешен.
    let call = 0;
    db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => {
      call += 1;
      if (call === 1) {
        throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
      }
      return cb(db);
    });
    // На ретрае ряд уже существует → ветка update.
    db.videoView.findUnique.mockResolvedValueOnce({
      id: 'vv-1',
      watchedIntervals: [],
      completedAt: null,
    });
    db.videoView.update.mockResolvedValueOnce({ id: 'vv-1' });

    const app = buildApp();
    const res = await post(app, {
      streamId: 's1',
      positionSec: 10,
      durationSec: 100,
      intervals: [[0, 10]],
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().watchedSec).toBe(10);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
});
