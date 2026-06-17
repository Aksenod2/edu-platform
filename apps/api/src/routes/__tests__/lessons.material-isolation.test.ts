import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// КРИТИЧНЫЙ ПО БЕЗОПАСНОСТИ тест: изоляция материалов/видео урока по группам.
// Студент потока A запрашивает урок, который ведут потоки A и B. В ответе НЕ должно
// быть материалов/видео потока B; общие (streamId=null) и потока A — есть. Чужие
// ключи не должны даже подписываться (getFileUrl не зовётся для чужих s3Key/videoKey).

// Мокаем prisma: только методы, которые трогает GET /lessons/:id (DB-free).
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

// S3: getFileUrl подписывает ключ как `signed:<key>` — так в ответе видно, какие
// ключи реально подписывались (для проверки «чужие не подписываются»).
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

const adminToken = signAccessToken({ userId: 'adm-1', role: 'admin' });
const studentToken = signAccessToken({ userId: 'stu-A', role: 'student' });

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
      // Старый материал без поля streamId — должен трактоваться как общий.
      { s3Key: 'mat-legacy', fileName: 'старый.pdf', mimeType: 'application/pdf', size: 1 },
    ],
    // Видео грузятся для студента отдельным запросом (lessonVideo.findMany) — здесь
    // в include приходит то, что вернёт мок findMany; для GET admin — это поле.
    videos: [] as typeof allVideos,
  };
}

// Все видео урока (как если бы их вернул запрос без фильтра — для админа).
const allVideos: {
  id: string;
  title: string | null;
  videoKey: string | null;
  videoUrl: string | null;
  sortOrder: number;
  streamId: string | null;
}[] = [
  { id: 'v-common', title: null, videoKey: null, videoUrl: 'https://x/common', sortOrder: 0, streamId: null },
  { id: 'v-A', title: null, videoKey: 'vk-A', videoUrl: null, sortOrder: 1, streamId: 'stream-A' },
  { id: 'v-B', title: null, videoKey: 'vk-B', videoUrl: null, sortOrder: 2, streamId: 'stream-B' },
];

beforeEach(() => {
  vi.clearAllMocks();
  getFileUrlMock.mockImplementation((key: string) => Promise.resolve(`signed:${key}`));
});

describe('GET /lessons/:id — изоляция материалов/видео по потокам (студент)', () => {
  it('студент потока A: видит общие + потока A; НЕ видит поток B; чужие ключи не подписываются', async () => {
    db.lesson.findUnique.mockResolvedValue(blockWithMixedMaterials());
    db.streamEnrollment.findMany.mockResolvedValue([{ streamId: 'stream-A' }]);
    db.session.findMany.mockResolvedValue([
      {
        streamId: 'stream-A',
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
      },
    ]);
    // Перевыборка видео студента на уровне SQL: возвращаем только общие + потока A
    // (как сделал бы where OR streamId null / = viewerStreamId).
    db.lessonVideo.findMany.mockResolvedValue([allVideos[0], allVideos[1]]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1?streamId=stream-A',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(200);
    const lesson = res.json().lesson;

    // ── Материалы: общие + поток A + legacy-без-поля; БЕЗ потока B ──────────────
    const matKeys = lesson.materials.map((m: { s3Key: string }) => m.s3Key).sort();
    expect(matKeys).toEqual(['mat-A', 'mat-common', 'mat-legacy']);
    expect(matKeys).not.toContain('mat-B');

    // ── Видео: общее + поток A; БЕЗ потока B ───────────────────────────────────
    const videoIds = lesson.videos.map((v: { id: string }) => v.id).sort();
    expect(videoIds).toEqual(['v-A', 'v-common']);
    expect(videoIds).not.toContain('v-B');

    // ── Видео фильтруются на уровне SQL: where OR(null, stream-A), а не в памяти ──
    expect(db.lessonVideo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lessonId: 'lesson-1', OR: [{ streamId: null }, { streamId: 'stream-A' }] },
      }),
    );

    // ── Чужой ключ материала потока B НЕ подписывался (не утёк и не тратили работу) ─
    const signedKeys = getFileUrlMock.mock.calls.map((c) => c[0]);
    expect(signedKeys).not.toContain('mat-B');
    expect(signedKeys).toContain('mat-A');
    expect(signedKeys).toContain('mat-common');
  });
});

describe('GET /lessons/:id — админ видит всё (без сужения)', () => {
  it('админ: видит материалы и видео ВСЕХ потоков (общие + A + B)', async () => {
    const block = blockWithMixedMaterials();
    block.videos = allVideos; // админу блок приходит со всеми видео (teacherInclude без where)
    db.lesson.findUnique.mockResolvedValue(block);
    db.session.findUnique.mockResolvedValue({
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
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1?streamId=stream-A',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const lesson = res.json().lesson;

    // Админ видит ВСЕ материалы (включая поток B) и все видео.
    const matKeys = lesson.materials.map((m: { s3Key: string }) => m.s3Key).sort();
    expect(matKeys).toEqual(['mat-A', 'mat-B', 'mat-common', 'mat-legacy']);
    const videoIds = lesson.videos.map((v: { id: string }) => v.id).sort();
    expect(videoIds).toEqual(['v-A', 'v-B', 'v-common']);

    // Для админа отдельной перевыборки видео по SQL-фильтру нет (видео уже в блоке).
    expect(db.lessonVideo.findMany).not.toHaveBeenCalled();
  });
});
