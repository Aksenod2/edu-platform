import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогает POST /lessons (DB-free).
// Новая модель: блок урока (Lesson) держит folded assignment*-поля; расписание
// и привязка к потоку — в Session/ProgramLesson.
vi.mock('@platform/db', () => ({
  prisma: {
    lesson: { create: vi.fn() },
    stream: { findUnique: vi.fn() },
    session: { upsert: vi.fn() },
    programLesson: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    lessonVideo: { findMany: vi.fn(() => Promise.resolve([])) },
  },
  // lessons.ts импортирует Prisma как значение (для типа LessonInclude через satisfies).
  Prisma: {},
}));

// Уведомления — no-op, чтобы хендлер выполнялся чисто.
vi.mock('../../lib/notifications.js', () => ({
  notifyMany: vi.fn(() => Promise.resolve()),
  createNotification: vi.fn(() => Promise.resolve()),
}));

// Зачисление — не нужно для admin-веток POST /lessons.
vi.mock('../../lib/enrollment.js', () => ({
  isEnrolled: vi.fn(() => Promise.resolve(true)),
}));

// S3 — no-op (подпись ссылок на материалы/видео).
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
}));

// Zoom — никаких встреч не создаём (assignment-флоу не трогает Zoom).
vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(() => Promise.resolve({ joinUrl: '', meetingId: '' })),
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

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Блок урока (форма, которую возвращает prisma.lesson.create в роуте).
function lessonBlock(over: Record<string, unknown> = {}) {
  return {
    id: 'lesson-1',
    title: 'Урок 1',
    videoUrl: null,
    videoKey: null,
    summary: null,
    notes: null,
    materials: [],
    sortOrder: 0,
    hasAssignment: false,
    assignmentTitle: null,
    assignmentDescription: null,
    assignmentCriteria: null,
    assignmentType: null,
    assignmentTags: [],
    assignmentMaterials: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    teachers: [],
    videos: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /lessons — folded assignment* (паритет с PATCH)', () => {
  it('без streamId: assignment*-поля персистятся в создаваемый блок-урок', async () => {
    db.lesson.create.mockImplementationOnce((args: { data: Record<string, unknown> }) =>
      Promise.resolve(lessonBlock({ ...args.data })),
    );

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      payload: {
        title: 'Урок 1',
        hasAssignment: true,
        assignmentTitle: 'Домашка',
        assignmentDescription: 'Сделать упражнения',
        assignmentCriteria: 'Аккуратность',
        assignmentType: 'long',
        assignmentTags: ['алгебра'],
        assignmentMaterials: [{ type: 'url', name: 'Справка', url: 'https://x' }],
      },
    });

    expect(res.statusCode).toBe(201);

    // assignment*-поля ушли в data создаваемого блока (а не молча проигнорированы).
    expect(db.lesson.create).toHaveBeenCalledTimes(1);
    const data = db.lesson.create.mock.calls[0][0].data;
    expect(data.hasAssignment).toBe(true);
    expect(data.assignmentTitle).toBe('Домашка');
    expect(data.assignmentDescription).toBe('Сделать упражнения');
    expect(data.assignmentCriteria).toBe('Аккуратность');
    expect(data.assignmentType).toBe('long');
    expect(data.assignmentTags).toEqual(['алгебра']);
    expect(data.assignmentMaterials).toEqual([
      { type: 'url', name: 'Справка', url: 'https://x' },
    ]);

    // Ответ-проекция тоже несёт folded assignment*.
    const lesson = res.json().lesson;
    expect(lesson.hasAssignment).toBe(true);
    expect(lesson.assignmentTitle).toBe('Домашка');
    expect(lesson.assignmentType).toBe('long');
  });

  it('со streamId: assignment*-поля персистятся в блок (а Session — для расписания)', async () => {
    db.lesson.create.mockImplementationOnce((args: { data: Record<string, unknown> }) =>
      Promise.resolve(lessonBlock({ ...args.data })),
    );
    db.stream.findUnique.mockResolvedValueOnce({ id: 'stream-1', status: 'active', programId: null });
    db.session.upsert.mockResolvedValueOnce({
      status: 'draft',
      date: null,
      startTime: null,
      meetingUrl: null,
      videoUrl: null,
      videoKey: null,
      summary: null,
      summarySource: null,
      recordingStatus: null,
      recordingError: null,
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      payload: {
        streamId: 'stream-1',
        title: 'Урок 2',
        hasAssignment: true,
        assignmentTitle: 'ДЗ к занятию',
      },
    });

    expect(res.statusCode).toBe(201);
    const data = db.lesson.create.mock.calls[0][0].data;
    expect(data.hasAssignment).toBe(true);
    expect(data.assignmentTitle).toBe('ДЗ к занятию');
  });

  it('без assignment*-полей блок создаётся без них (аддитивность — старый веб-флоу не меняется)', async () => {
    db.lesson.create.mockImplementationOnce((args: { data: Record<string, unknown> }) =>
      Promise.resolve(lessonBlock({ ...args.data })),
    );

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      payload: { title: 'Урок без ДЗ' },
    });

    expect(res.statusCode).toBe(201);
    const data = db.lesson.create.mock.calls[0][0].data;
    expect('hasAssignment' in data).toBe(false);
    expect('assignmentTitle' in data).toBe(false);
  });

  it('невалидный assignmentType → 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      payload: { title: 'Урок', assignmentType: 'medium' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.lesson.create).not.toHaveBeenCalled();
  });
});

describe('POST /lessons — обязательное время начала для planned (issue #169)', () => {
  it('planned со streamId без startTime → 400, блок не создаём', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      // дата есть, статус planned, но времени начала нет
      payload: { streamId: 'stream-1', title: 'Урок', status: 'planned', date: '2026-07-01' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('время начала');
    expect(db.lesson.create).not.toHaveBeenCalled();
  });

  it('planned со streamId с датой и startTime → 201', async () => {
    db.lesson.create.mockImplementationOnce((args: { data: Record<string, unknown> }) =>
      Promise.resolve(lessonBlock({ ...args.data })),
    );
    db.stream.findUnique.mockResolvedValueOnce({ id: 'stream-1', status: 'active', programId: null });
    db.session.upsert.mockResolvedValueOnce({
      status: 'planned',
      date: new Date('2026-07-01'),
      startTime: '10:00',
      meetingUrl: null,
      videoUrl: null,
      videoKey: null,
      summary: null,
      summarySource: null,
      recordingStatus: null,
      recordingError: null,
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      payload: {
        streamId: 'stream-1',
        title: 'Урок',
        status: 'planned',
        date: '2026-07-01',
        startTime: '10:00',
      },
    });

    expect(res.statusCode).toBe(201);
  });
});
