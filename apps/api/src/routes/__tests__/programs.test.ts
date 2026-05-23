import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогают тестируемые ветки (DB-free).
vi.mock('@platform/db', () => ({
  prisma: {
    apiKey: { findUnique: vi.fn(), update: vi.fn(() => Promise.resolve({})) },
    program: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    programLesson: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    lesson: { findUnique: vi.fn(), create: vi.fn() },
    stream: { findUnique: vi.fn() },
    session: { upsert: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn((ops: any) => Promise.all(ops)),
  },
}));

// Уведомления и S3 — no-op (нужны для импорта lessons.ts).
vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
}));

vi.mock('../../lib/enrollment.js', () => ({
  isEnrolled: vi.fn(() => Promise.resolve(false)),
}));

import { programRoutes } from '../programs.js';
import { lessonRoutes } from '../lessons.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(register: (app: FastifyInstance) => void): FastifyInstance {
  const app = Fastify();
  register(app);
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

describe('Программы — авторизация', () => {
  it('GET /programs студентом → 403', async () => {
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'GET',
      url: '/programs',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /programs без токена → 401', async () => {
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({ method: 'GET', url: '/programs' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /programs — список со счётчиками', () => {
  it('возвращает программы с lessonsCount и streamsCount', async () => {
    db.program.findMany.mockResolvedValueOnce([
      {
        id: 'p-1',
        name: 'Курс А',
        type: 'course',
        whatYouLearn: null,
        _count: { programLessons: 3, streams: 2 },
      },
    ]);

    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'GET',
      url: '/programs',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { programs: { lessonsCount: number; streamsCount: number }[] };
    expect(body.programs).toHaveLength(1);
    expect(body.programs[0].lessonsCount).toBe(3);
    expect(body.programs[0].streamsCount).toBe(2);
  });
});

describe('POST /programs — создание', () => {
  it('создаёт программу, type по умолчанию course, ownerId = текущий пользователь', async () => {
    db.program.create.mockResolvedValueOnce({ id: 'p-1', name: 'Курс А', type: 'course' });

    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs',
      headers: authHeaders(adminToken),
      payload: { name: 'Курс А' },
    });

    expect(res.statusCode).toBe(201);
    const arg = db.program.create.mock.calls[0][0];
    expect(arg.data.type).toBe('course');
    expect(arg.data.ownerId).toBe('admin-1');
    expect(arg.data.name).toBe('Курс А');
  });

  it('пустое имя → 400', async () => {
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs',
      headers: authHeaders(adminToken),
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.program.create).not.toHaveBeenCalled();
  });

  it('недопустимый type → 400', async () => {
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs',
      headers: authHeaders(adminToken),
      payload: { name: 'Курс', type: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.program.create).not.toHaveBeenCalled();
  });

  it('валидный type intensive принимается', async () => {
    db.program.create.mockResolvedValueOnce({ id: 'p-2', name: 'Интенсив', type: 'intensive' });
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs',
      headers: authHeaders(adminToken),
      payload: { name: 'Интенсив', type: 'intensive' },
    });
    expect(res.statusCode).toBe(201);
    expect(db.program.create.mock.calls[0][0].data.type).toBe('intensive');
  });
});

describe('PATCH /programs/:id — обновление', () => {
  it('несуществующая программа → 404', async () => {
    db.program.findUnique.mockResolvedValueOnce(null);
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'PATCH',
      url: '/programs/missing',
      headers: authHeaders(adminToken),
      payload: { name: 'Новое' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('обновляет имя и type', async () => {
    db.program.findUnique.mockResolvedValueOnce({ id: 'p-1' });
    db.program.update.mockResolvedValueOnce({ id: 'p-1', name: 'Б', type: 'mentorship' });
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'PATCH',
      url: '/programs/p-1',
      headers: authHeaders(adminToken),
      payload: { name: 'Б', type: 'mentorship' },
    });
    expect(res.statusCode).toBe(200);
    const arg = db.program.update.mock.calls[0][0];
    expect(arg.data.name).toBe('Б');
    expect(arg.data.type).toBe('mentorship');
  });
});

describe('DELETE /programs/:id — удаление', () => {
  it('удаляет существующую программу', async () => {
    db.program.findUnique.mockResolvedValueOnce({ id: 'p-1' });
    db.program.delete.mockResolvedValueOnce({ id: 'p-1' });
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'DELETE',
      url: '/programs/p-1',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(db.program.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
  });

  it('несуществующая → 404', async () => {
    db.program.findUnique.mockResolvedValueOnce(null);
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'DELETE',
      url: '/programs/missing',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(db.program.delete).not.toHaveBeenCalled();
  });
});

describe('POST /programs/:id/lessons — привязка урока', () => {
  it('привязывает урок в конец (sortOrder = max+1)', async () => {
    db.program.findUnique.mockResolvedValueOnce({ id: 'p-1' });
    db.lesson.findUnique.mockResolvedValueOnce({ id: 'l-1' });
    db.programLesson.findUnique.mockResolvedValueOnce(null); // ещё не привязан
    db.programLesson.findFirst.mockResolvedValueOnce({ sortOrder: 4 });
    db.programLesson.create.mockResolvedValueOnce({
      id: 'pl-1',
      programId: 'p-1',
      lessonId: 'l-1',
      sortOrder: 5,
    });

    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs/p-1/lessons',
      headers: authHeaders(adminToken),
      payload: { lessonId: 'l-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.programLesson.create.mock.calls[0][0].data.sortOrder).toBe(5);
  });

  it('идемпотентность: уже привязан → не дублирует, 200', async () => {
    db.program.findUnique.mockResolvedValueOnce({ id: 'p-1' });
    db.lesson.findUnique.mockResolvedValueOnce({ id: 'l-1' });
    db.programLesson.findUnique.mockResolvedValueOnce({
      id: 'pl-1',
      programId: 'p-1',
      lessonId: 'l-1',
      sortOrder: 0,
    });

    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs/p-1/lessons',
      headers: authHeaders(adminToken),
      payload: { lessonId: 'l-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.programLesson.create).not.toHaveBeenCalled();
  });

  it('без lessonId → 400', async () => {
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs/p-1/lessons',
      headers: authHeaders(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('несуществующий урок → 404', async () => {
    db.program.findUnique.mockResolvedValueOnce({ id: 'p-1' });
    db.lesson.findUnique.mockResolvedValueOnce(null);
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/programs/p-1/lessons',
      headers: authHeaders(adminToken),
      payload: { lessonId: 'missing' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /programs/:id/lessons/:lessonId — отвязка', () => {
  it('отвязывает урок (идемпотентно)', async () => {
    db.programLesson.deleteMany.mockResolvedValueOnce({ count: 1 });
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'DELETE',
      url: '/programs/p-1/lessons/l-1',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(db.programLesson.deleteMany).toHaveBeenCalledWith({
      where: { programId: 'p-1', lessonId: 'l-1' },
    });
  });
});

describe('PATCH /programs/:id/lessons/reorder — переупорядочивание', () => {
  it('выставляет sortOrder по порядку массива (только привязанные уроки)', async () => {
    db.program.findUnique.mockResolvedValueOnce({ id: 'p-1' });
    db.programLesson.findMany
      .mockResolvedValueOnce([{ lessonId: 'l-1' }, { lessonId: 'l-2' }, { lessonId: 'l-3' }])
      .mockResolvedValueOnce([
        { lessonId: 'l-3', sortOrder: 0 },
        { lessonId: 'l-1', sortOrder: 1 },
        { lessonId: 'l-2', sortOrder: 2 },
      ]);
    db.programLesson.update.mockResolvedValue({});

    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'PATCH',
      url: '/programs/p-1/lessons/reorder',
      headers: authHeaders(adminToken),
      payload: { lessonIds: ['l-3', 'l-1', 'l-2'] },
    });

    expect(res.statusCode).toBe(200);
    // Три обновления, sortOrder по индексу.
    expect(db.programLesson.update).toHaveBeenCalledTimes(3);
    const calls = db.programLesson.update.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => ({ lessonId: c[0].where.programId_lessonId.lessonId, sortOrder: c[0].data.sortOrder }),
    );
    expect(calls).toEqual([
      { lessonId: 'l-3', sortOrder: 0 },
      { lessonId: 'l-1', sortOrder: 1 },
      { lessonId: 'l-2', sortOrder: 2 },
    ]);
  });

  it('игнорирует чужие lessonId (не из программы)', async () => {
    db.program.findUnique.mockResolvedValueOnce({ id: 'p-1' });
    db.programLesson.findMany
      .mockResolvedValueOnce([{ lessonId: 'l-1' }])
      .mockResolvedValueOnce([{ lessonId: 'l-1', sortOrder: 0 }]);
    db.programLesson.update.mockResolvedValue({});

    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'PATCH',
      url: '/programs/p-1/lessons/reorder',
      headers: authHeaders(adminToken),
      payload: { lessonIds: ['l-1', 'foreign'] },
    });

    expect(res.statusCode).toBe(200);
    // Только привязанный l-1 обновлён.
    expect(db.programLesson.update).toHaveBeenCalledTimes(1);
  });

  it('lessonIds не массив → 400', async () => {
    const app = buildApp((a) => a.register(programRoutes));
    const res = await app.inject({
      method: 'PATCH',
      url: '/programs/p-1/lessons/reorder',
      headers: authHeaders(adminToken),
      payload: { lessonIds: 'nope' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /lessons — создание блока без потока', () => {
  it('без streamId создаёт только блок (без Session/ProgramLesson), streamId=null, status=draft', async () => {
    db.lesson.create.mockResolvedValueOnce({
      id: 'l-new',
      title: 'Блок урока',
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
    });

    const app = buildApp((a) => a.register(lessonRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      payload: { title: 'Блок урока' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { lesson: { id: string; streamId: string | null; status: string } };
    expect(body.lesson.id).toBe('l-new');
    expect(body.lesson.streamId).toBeNull();
    expect(body.lesson.status).toBe('draft');

    // Без потока: ни Session, ни ProgramLesson не трогаем.
    expect(db.session.upsert).not.toHaveBeenCalled();
    expect(db.programLesson.create).not.toHaveBeenCalled();
    expect(db.stream.findUnique).not.toHaveBeenCalled();
  });

  it('без title → 400', async () => {
    const app = buildApp((a) => a.register(lessonRoutes));
    const res = await app.inject({
      method: 'POST',
      url: '/lessons',
      headers: authHeaders(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(db.lesson.create).not.toHaveBeenCalled();
  });
});
