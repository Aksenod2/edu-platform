import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// КРИТИЧНЫЙ ПО БЕЗОПАСНОСТИ тест (баг #158): изоляция КОНТЕКСТА ПОТОКА в GET
// /lessons/:id для студента, зачисленного в ДВА потока (A и B), у которых есть
// Session этого урока. Защита на бэке (фронт чинится отдельно):
//   1) передан валидный streamId таба → контекст = именно он (не «первый попавшийся»);
//   2) передан невалидный streamId (не зачислен) → 404, чужой контент не утекает;
//   3) streamId не передан → детерминированный fallback (стабильный поток), не падаем.

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
      lessonVideo: { findFirst: vi.fn(), findMany: vi.fn() },
      programLesson: { findMany: vi.fn() },
      lessonTeacher: { findMany: vi.fn(), findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
    Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError },
  };
});

vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

const getFileUrlMock = vi.fn((key: string) => Promise.resolve(`signed:${key}`));
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: (key: string) => getFileUrlMock(key),
}));

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

const studentToken = signAccessToken({ userId: 'stu-AB', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Урок-блок с материалами трёх видов: общий (null), потока A, потока B.
function blockWithMixedMaterials() {
  return {
    id: 'lesson-1',
    title: 'Урок 1',
    videoUrl: null,
    videoKey: null,
    summary: null,
    notes: null,
    sortOrder: 0,
    hasAssignment: false,
    assignmentTitle: null,
    assignmentDescription: null,
    assignmentCriteria: null,
    assignmentType: null,
    assignmentTags: [],
    assignmentMaterials: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    teachers: [],
    materials: [
      { s3Key: 'mat-common', fileName: 'общий.pdf', mimeType: 'application/pdf', size: 1, streamId: null },
      { s3Key: 'mat-A', fileName: 'поток-A.pdf', mimeType: 'application/pdf', size: 1, streamId: 'stream-A' },
      { s3Key: 'mat-B', fileName: 'поток-B.pdf', mimeType: 'application/pdf', size: 1, streamId: 'stream-B' },
    ],
    videos: [] as never[],
  };
}

// Готовая Session нужного потока (всё nullable, status='done' → видна студенту).
function sessionFor(streamId: string) {
  return {
    streamId,
    status: 'done',
    date: null,
    startTime: null,
    meetingUrl: null,
    videoUrl: null,
    videoKey: null,
    summary: null,
    summarySource: null,
    summaryStatus: null,
    recordingStatus: null,
    recordingError: null,
    recordingRequestedAt: null,
    summaryRequestedAt: null,
    transcriptStatus: null,
    transcriptError: null,
    transcriptRequestedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFileUrlMock.mockImplementation((key: string) => Promise.resolve(`signed:${key}`));
});

describe('GET /lessons/:id — контекст потока для студента в двух потоках (баг #158)', () => {
  it('передан streamId потока A → контекст = A, материалы/видео A (не B)', async () => {
    db.lesson.findUnique.mockResolvedValue(blockWithMixedMaterials());
    db.streamEnrollment.findMany.mockResolvedValue([{ streamId: 'stream-A' }, { streamId: 'stream-B' }]);
    // Кандидаты сужены до A (фронт прислал streamId=stream-A) → findMany вернёт только A.
    db.session.findMany.mockResolvedValue([sessionFor('stream-A')]);
    // Видео потока A (общее + A): перевыборка по where OR(null, stream-A).
    db.lessonVideo.findMany.mockResolvedValue([
      { id: 'v-common', title: null, videoKey: null, videoUrl: 'https://x/common', sortOrder: 0, streamId: null },
      { id: 'v-A', title: null, videoKey: 'vk-A', videoUrl: null, sortOrder: 1, streamId: 'stream-A' },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1?streamId=stream-A',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(200);
    const lesson = res.json().lesson;

    // Контекст-поток = именно переданный A.
    expect(lesson.streamId).toBe('stream-A');

    // findMany звался ТОЛЬКО по потоку A (приоритет переданного streamId), с orderBy.
    expect(db.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lessonId: 'lesson-1', streamId: { in: ['stream-A'] } },
        orderBy: [{ createdAt: 'asc' }, { streamId: 'asc' }],
      }),
    );

    // Видео фильтруются по контексту A (общие + A), не по B.
    expect(db.lessonVideo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lessonId: 'lesson-1', OR: [{ streamId: null }, { streamId: 'stream-A' }] },
      }),
    );

    const matKeys = lesson.materials.map((m: { s3Key: string }) => m.s3Key).sort();
    expect(matKeys).toEqual(['mat-A', 'mat-common']);
    expect(matKeys).not.toContain('mat-B');

    const signedKeys = getFileUrlMock.mock.calls.map((c) => c[0]);
    expect(signedKeys).not.toContain('mat-B');
  });

  it('передан streamId потока B → контекст = B (а не «первый» A)', async () => {
    db.lesson.findUnique.mockResolvedValue(blockWithMixedMaterials());
    db.streamEnrollment.findMany.mockResolvedValue([{ streamId: 'stream-A' }, { streamId: 'stream-B' }]);
    db.session.findMany.mockResolvedValue([sessionFor('stream-B')]);
    db.lessonVideo.findMany.mockResolvedValue([
      { id: 'v-common', title: null, videoKey: null, videoUrl: 'https://x/common', sortOrder: 0, streamId: null },
      { id: 'v-B', title: null, videoKey: 'vk-B', videoUrl: null, sortOrder: 2, streamId: 'stream-B' },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1?streamId=stream-B',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(200);
    const lesson = res.json().lesson;
    expect(lesson.streamId).toBe('stream-B');

    expect(db.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lessonId: 'lesson-1', streamId: { in: ['stream-B'] } },
      }),
    );
    expect(db.lessonVideo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lessonId: 'lesson-1', OR: [{ streamId: null }, { streamId: 'stream-B' }] },
      }),
    );

    const matKeys = lesson.materials.map((m: { s3Key: string }) => m.s3Key).sort();
    expect(matKeys).toEqual(['mat-B', 'mat-common']);
    expect(matKeys).not.toContain('mat-A');
  });

  it('передан невалидный streamId (студент не зачислён) → 404, чужое не утекает', async () => {
    db.lesson.findUnique.mockResolvedValue(blockWithMixedMaterials());
    db.streamEnrollment.findMany.mockResolvedValue([{ streamId: 'stream-A' }, { streamId: 'stream-B' }]);
    // findMany не должен вообще вызываться: candidateStreamIds окажется пустым.

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1?streamId=stream-C',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(404);
    // Не лезли за сессиями/видео чужого потока и ничего не подписывали.
    expect(db.session.findMany).not.toHaveBeenCalled();
    expect(db.lessonVideo.findMany).not.toHaveBeenCalled();
    expect(getFileUrlMock).not.toHaveBeenCalled();
  });

  it('передан streamId зачисленного потока, но Session этого урока там черновик → 404', async () => {
    db.lesson.findUnique.mockResolvedValue(blockWithMixedMaterials());
    db.streamEnrollment.findMany.mockResolvedValue([{ streamId: 'stream-A' }, { streamId: 'stream-B' }]);
    // Для потока A у урока только черновая Session → студенту не видна.
    db.session.findMany.mockResolvedValue([{ ...sessionFor('stream-A'), status: 'draft' }]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1?streamId=stream-A',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(404);
    // Сужали кандидатов до A (не подставляли B как «первый недрафтовый»).
    expect(db.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lessonId: 'lesson-1', streamId: { in: ['stream-A'] } },
      }),
    );
    expect(db.lessonVideo.findMany).not.toHaveBeenCalled();
  });

  it('streamId не передан → детерминированный fallback с orderBy, не падаем', async () => {
    db.lesson.findUnique.mockResolvedValue(blockWithMixedMaterials());
    db.streamEnrollment.findMany.mockResolvedValue([{ streamId: 'stream-A' }, { streamId: 'stream-B' }]);
    // Оба потока имеют недрафтовую Session; «первый недрафтовый» берётся из
    // упорядоченного findMany. Мок отдаёт A первым (как сделал бы orderBy createdAt asc).
    db.session.findMany.mockResolvedValue([sessionFor('stream-A'), sessionFor('stream-B')]);
    db.lessonVideo.findMany.mockResolvedValue([
      { id: 'v-common', title: null, videoKey: null, videoUrl: 'https://x/common', sortOrder: 0, streamId: null },
      { id: 'v-A', title: null, videoKey: 'vk-A', videoUrl: null, sortOrder: 1, streamId: 'stream-A' },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(200);
    const lesson = res.json().lesson;
    // Контекст = первый по детерминированному порядку (A).
    expect(lesson.streamId).toBe('stream-A');

    // Перебираем все потоки студента, НО с orderBy — выбор стабилен (не случаен).
    expect(db.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lessonId: 'lesson-1', streamId: { in: ['stream-A', 'stream-B'] } },
        orderBy: [{ createdAt: 'asc' }, { streamId: 'asc' }],
      }),
    );
  });
});
