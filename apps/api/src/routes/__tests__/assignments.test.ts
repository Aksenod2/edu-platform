import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогают тестируемые ветки (DB-free).
// Новая модель: задание свёрнуто в Lesson (блок), дедлайн на Session,
// StudentAssignment ссылается на Session (sessionId).
vi.mock('@platform/db', () => ({
  prisma: {
    stream: { findUnique: vi.fn() },
    lesson: { findUnique: vi.fn(), update: vi.fn() },
    session: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    streamEnrollment: { findMany: vi.fn(), findUnique: vi.fn() },
    studentAssignment: { createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    conversation: { findUnique: vi.fn(), create: vi.fn() },
    conversationEntry: { create: vi.fn() },
  },
}));

// Уведомления — no-op, чтобы хендлер выполнялся чисто.
vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

// S3 — no-op (генерация ссылок на материалы/файлы).
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
}));

import { assignmentRoutes } from '../assignments.js';
import { prisma } from '@platform/db';
import { notifyMany } from '../../lib/notifications.js';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(assignmentRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });
const studentToken = (id: string) => signAccessToken({ userId: id, role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Блок урока с folded assignment*-полями (минимум для проекции).
function lessonBlock(over: Record<string, unknown> = {}) {
  return {
    id: 'lesson-1',
    title: 'Урок 1',
    hasAssignment: true,
    assignmentTitle: 'Задание 1',
    assignmentDescription: null,
    assignmentCriteria: null,
    assignmentType: 'short',
    assignmentTags: [],
    assignmentMaterials: [],
    ...over,
  };
}

// Session с подгруженным блоком урока (форма select из роута).
function sessionWithLesson(over: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    streamId: 'stream-1',
    lessonId: 'lesson-1',
    dueDate: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lesson: lessonBlock(),
    stream: { id: 'stream-1', name: 'Поток 1' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /assignments — автовыдача зачисленным студентам', () => {
  it('пишет блок урока + Session.dueDate и создаёт назначения по sessionId всем студентам потока', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 'stream-1', status: 'active' });
    db.lesson.findUnique.mockResolvedValueOnce({ id: 'lesson-1', title: 'Урок 1' });
    db.lesson.update.mockResolvedValueOnce(lessonBlock());
    // Session upsert возвращает Session с блоком урока и потоком.
    db.session.upsert.mockResolvedValueOnce(sessionWithLesson());
    db.streamEnrollment.findMany.mockResolvedValueOnce([
      { userId: 'u-1' },
      { userId: 'u-2' },
      { userId: 'u-3' },
    ]);
    db.studentAssignment.createMany.mockResolvedValueOnce({ count: 3 });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/assignments',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1', lessonId: 'lesson-1', title: 'Задание 1', type: 'short' },
    });

    expect(res.statusCode).toBe(201);

    // Folded assignment*-поля записаны в БЛОК выбранного урока.
    expect(db.lesson.update).toHaveBeenCalledTimes(1);
    const lessonUpdateArg = db.lesson.update.mock.calls[0][0];
    expect(lessonUpdateArg.where).toEqual({ id: 'lesson-1' });
    expect(lessonUpdateArg.data.hasAssignment).toBe(true);
    expect(lessonUpdateArg.data.assignmentTitle).toBe('Задание 1');

    // Session(streamId, lessonId) заведена/обновлена (несёт дедлайн).
    expect(db.session.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = db.session.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({
      streamId_lessonId: { streamId: 'stream-1', lessonId: 'lesson-1' },
    });

    // Автовыдача: StudentAssignment по sessionId для каждого зачисленного.
    expect(db.studentAssignment.createMany).toHaveBeenCalledTimes(1);
    const arg = db.studentAssignment.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(3);
    expect(arg.data).toEqual(
      expect.arrayContaining([
        { sessionId: 'session-1', studentId: 'u-1', status: 'assigned' },
        { sessionId: 'session-1', studentId: 'u-2', status: 'assigned' },
        { sessionId: 'session-1', studentId: 'u-3', status: 'assigned' },
      ]),
    );
    expect(arg.data.every((d: { status: string }) => d.status === 'assigned')).toBe(true);
    // Ключ — sessionId, а не assignmentId (старой сущности больше нет).
    expect(arg.data.every((d: { sessionId: string }) => d.sessionId === 'session-1')).toBe(true);

    // Синтетический id задания = sessionId.
    const body = res.json() as { assignment: { id: string; _count?: { studentAssignments: number } } };
    expect(body.assignment.id).toBe('session-1');

    // Уведомлены те же 3 студента.
    expect(notifyMany).toHaveBeenCalledTimes(1);
    expect((notifyMany as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toEqual([
      'u-1',
      'u-2',
      'u-3',
    ]);
  });
});

describe('PATCH /student-assignments/:id — проверка работы (review)', () => {
  it('admin ставит status reviewed с reviewText → update содержит reviewText, reviewedBy и status', async () => {
    // Сдача с её Session и блоком урока (с преподавателями для уведомлений).
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });
    // имя проверяющего админа
    db.user.findUnique.mockResolvedValueOnce({ name: 'Преподаватель Иван' });
    // update возвращает строку с подгруженными session (+lesson) и student.
    db.studentAssignment.update.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'reviewed',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      reviewText: 'Отлично, зачёт',
      reviewedBy: 'Преподаватель Иван',
      session: sessionWithLesson(),
      student: { id: 'stu-1', name: 'Студент', email: 's@e.ru' },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(adminToken),
      payload: { status: 'reviewed', reviewText: 'Отлично, зачёт' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.studentAssignment.update).toHaveBeenCalledTimes(1);

    const updateArg = db.studentAssignment.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'sa-1' });
    expect(updateArg.data.status).toBe('reviewed');
    expect(updateArg.data.reviewText).toBe('Отлично, зачёт');
    expect(updateArg.data.reviewedBy).toBe('Преподаватель Иван');

    // Ответ всё ещё проецирует легаси-объект assignment (id = sessionId).
    const body = res.json() as { studentAssignment: { assignmentId: string; assignment: { id: string } } };
    expect(body.studentAssignment.assignmentId).toBe('session-1');
    expect(body.studentAssignment.assignment.id).toBe('session-1');
  });

  it('студент НЕ может ставить status reviewed → 403', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(studentToken('stu-1')),
      payload: { status: 'reviewed', reviewText: 'сам себе зачёт' },
    });

    expect(res.statusCode).toBe(403);
    expect(db.studentAssignment.update).not.toHaveBeenCalled();
  });

  // Задача A — причина обязательна при «На доработку».
  it('admin ставит needs_revision БЕЗ reviewText → 400 «Укажите причину доработки»', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(adminToken),
      payload: { status: 'needs_revision' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Укажите причину доработки' });
    expect(db.studentAssignment.update).not.toHaveBeenCalled();
  });

  it('admin ставит needs_revision с reviewText из пробелов → 400', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(adminToken),
      payload: { status: 'needs_revision', reviewText: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.studentAssignment.update).not.toHaveBeenCalled();
  });

  it('admin ставит needs_revision с непустым reviewText → ок, update пишет reviewText/reviewedBy', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });
    db.user.findUnique.mockResolvedValueOnce({ name: 'Преподаватель Иван' });
    db.studentAssignment.update.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'needs_revision',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      reviewText: 'Переделай введение',
      reviewedBy: 'Преподаватель Иван',
      session: sessionWithLesson(),
      student: { id: 'stu-1', name: 'Студент', email: 's@e.ru' },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(adminToken),
      payload: { status: 'needs_revision', reviewText: 'Переделай введение' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.studentAssignment.update).toHaveBeenCalledTimes(1);
    const updateArg = db.studentAssignment.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('needs_revision');
    expect(updateArg.data.reviewText).toBe('Переделай введение');
    expect(updateArg.data.reviewedBy).toBe('Преподаватель Иван');
  });

  // reviewed остаётся без обязательного reviewText.
  it('admin ставит reviewed БЕЗ reviewText → ок (причина опциональна)', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });
    db.user.findUnique.mockResolvedValueOnce({ name: 'Преподаватель Иван' });
    db.studentAssignment.update.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'reviewed',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      reviewText: null,
      reviewedBy: 'Преподаватель Иван',
      session: sessionWithLesson(),
      student: { id: 'stu-1', name: 'Студент', email: 's@e.ru' },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(adminToken),
      payload: { status: 'reviewed' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.studentAssignment.update).toHaveBeenCalledTimes(1);
    expect(db.studentAssignment.update.mock.calls[0][0].data.status).toBe('reviewed');
  });
});

describe('PATCH /student-assignments/:id — сдача студентом (submit)', () => {
  // Задача C — повторная отправка из submitted (правка/дослать) разрешена.
  it('студент переотправляет из submitted → ок, content/file обновлены, submittedAt свежий', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      content: 'старый ответ',
      fileUrl: 'old-key',
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });
    db.conversation.findUnique.mockResolvedValueOnce({ id: 'conv-1' });
    db.conversationEntry.create.mockResolvedValueOnce({ id: 'ce-1' });
    // stream.findUnique не замокан → у потока нет преподавателей → фолбэк на админов (notifyMany).
    db.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
    db.studentAssignment.update.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      content: 'новый ответ',
      fileUrl: null,
      session: sessionWithLesson(),
      student: { id: 'stu-1', name: 'Студент', email: 's@e.ru' },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(studentToken('stu-1')),
      payload: { status: 'submitted', answerText: 'новый ответ' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.studentAssignment.update).toHaveBeenCalledTimes(1);
    const updateArg = db.studentAssignment.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('submitted');
    expect(updateArg.data.content).toBe('новый ответ');
    expect(updateArg.data.submittedAt).toBeInstanceOf(Date);
  });

  it('студент сдаёт из assigned → ок', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'assigned',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });
    db.conversation.findUnique.mockResolvedValueOnce({ id: 'conv-1' });
    db.conversationEntry.create.mockResolvedValueOnce({ id: 'ce-1' });
    // stream.findUnique не замокан → у потока нет преподавателей → фолбэк на админов (notifyMany).
    db.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
    db.studentAssignment.update.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      content: 'ответ',
      fileUrl: null,
      session: sessionWithLesson(),
      student: { id: 'stu-1', name: 'Студент', email: 's@e.ru' },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(studentToken('stu-1')),
      payload: { status: 'submitted', answerText: 'ответ' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.studentAssignment.update).toHaveBeenCalledTimes(1);
  });

  it('сдача → уведомление получают преподаватели ПОТОКА (а не все админы)', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'assigned',
      studentId: 'stu-1',
      session: { streamId: 'stream-1' },
    });
    // getStreamTeacherList(stream-1): поток с двумя преподавателями (program + sessions),
    // один из них дублируется между источниками — на выходе ожидаем дедуп.
    db.stream.findUnique.mockResolvedValueOnce({
      program: {
        id: 'prog-1',
        name: 'Программа',
        type: 'course',
        programLessons: [
          { lesson: { teachers: [{ user: { id: 'teach-1', name: 'Препод 1' } }] } },
        ],
      },
      sessions: [
        {
          lesson: {
            teachers: [
              { user: { id: 'teach-1', name: 'Препод 1' } },
              { user: { id: 'teach-2', name: 'Препод 2' } },
            ],
          },
        },
      ],
    });
    // Фильтр активности преподавателей: оба активны.
    db.user.findMany.mockResolvedValueOnce([{ id: 'teach-1' }, { id: 'teach-2' }]);
    db.studentAssignment.update.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      sessionId: 'session-1',
      content: 'ответ',
      fileUrl: null,
      session: sessionWithLesson(),
      student: { id: 'stu-1', name: 'Студент', email: 's@e.ru' },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(studentToken('stu-1')),
      payload: { status: 'submitted', answerText: 'ответ' },
    });

    expect(res.statusCode).toBe(200);
    expect(notifyMany).toHaveBeenCalledTimes(1);
    const calls = (notifyMany as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0][0]).toEqual(['teach-1', 'teach-2']);
    expect(calls[0][1]).toBe('assignment_submitted');
    // Админский фолбэк НЕ запрашивался: единственный user.findMany — фильтр активности преподавателей.
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const findManyArg = db.user.findMany.mock.calls[0][0];
    expect(findManyArg.where.id).toEqual({ in: ['teach-1', 'teach-2'] });
  });

  it('студент НЕ может переотправить из reviewed → 400 (заморожено)', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'reviewed',
      studentId: 'stu-1',
      sessionId: 'session-1',
      fileUrl: null,
      session: {
        id: 'session-1',
        streamId: 'stream-1',
        lessonId: 'lesson-1',
        lesson: { ...lessonBlock(), teachers: [] },
      },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/student-assignments/sa-1',
      headers: authHeaders(studentToken('stu-1')),
      payload: { status: 'submitted', answerText: 'хочу переделать' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.studentAssignment.update).not.toHaveBeenCalled();
  });
});

// ─── Авторизация чтения заданий (фикс утечки чужого контента) ────────────────
//
// GET /assignments и GET /assignments/:id раньше стояли под anyAuth без проверки
// зачисления: любой студент получал задания всех групп (включая подписанные
// ссылки на платные материалы). Теперь: студент видит только задания потоков,
// на которые зачислён; _count.studentAssignments отдаётся только админу.

describe('GET /assignments — доступ студента ограничен его потоками', () => {
  it('студент с чужим streamId → 403, выборка заданий не выполняется', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 'stream-1', name: 'Поток 1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce(null); // не зачислен

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/assignments?streamId=stream-1',
      headers: authHeaders(studentToken('stu-1')),
    });

    expect(res.statusCode).toBe(403);
    expect(db.session.findMany).not.toHaveBeenCalled();
  });

  it('студент со своим streamId → 200, без _count (число сдач — только админу)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 'stream-1', name: 'Поток 1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' }); // зачислен
    db.session.findMany.mockResolvedValueOnce([sessionWithLesson()]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/assignments?streamId=stream-1',
      headers: authHeaders(studentToken('stu-1')),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { assignments: Array<Record<string, unknown>> };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].id).toBe('session-1');
    // _count не запрошен из БД и не отдан студенту.
    const select = db.session.findMany.mock.calls[0][0].select;
    expect(select._count).toBeUndefined();
    expect(body.assignments[0]._count).toBeUndefined();
  });

  it('студент без streamId → список фильтруется по его зачислениям (не все группы)', async () => {
    db.session.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/assignments',
      headers: authHeaders(studentToken('stu-1')),
    });

    expect(res.statusCode).toBe(200);
    const where = db.session.findMany.mock.calls[0][0].where;
    expect(where.stream).toEqual({ enrollments: { some: { userId: 'stu-1' } } });
  });

  it('админ без streamId → все задания, с _count, без фильтра по зачислениям', async () => {
    db.session.findMany.mockResolvedValueOnce([
      sessionWithLesson({ _count: { studentAssignments: 5 } }),
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/assignments',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const arg = db.session.findMany.mock.calls[0][0];
    expect(arg.where.stream).toBeUndefined(); // админ не ограничен зачислениями
    expect(arg.select._count).toEqual({ select: { studentAssignments: true } });
    const body = res.json() as { assignments: Array<{ _count?: { studentAssignments: number } }> };
    expect(body.assignments[0]._count).toEqual({ studentAssignments: 5 });
    // Проверка зачисления для админа не выполняется.
    expect(db.streamEnrollment.findUnique).not.toHaveBeenCalled();
  });
});

describe('GET /assignments/:id — студент не получает задание чужого потока', () => {
  it('студент без зачисления в поток задания → 404 (существование не раскрываем)', async () => {
    db.session.findUnique.mockResolvedValueOnce(sessionWithLesson());
    db.streamEnrollment.findUnique.mockResolvedValueOnce(null); // не зачислен

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/assignments/session-1',
      headers: authHeaders(studentToken('stu-1')),
    });

    expect(res.statusCode).toBe(404);
  });

  it('зачисленный студент получает задание своего потока (без _count)', async () => {
    db.session.findUnique.mockResolvedValueOnce(sessionWithLesson());
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/assignments/session-1',
      headers: authHeaders(studentToken('stu-1')),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { assignment: Record<string, unknown> };
    expect(body.assignment.id).toBe('session-1');
    expect(body.assignment._count).toBeUndefined();
    // Зачисление сверено именно с потоком задания.
    expect(db.streamEnrollment.findUnique).toHaveBeenCalledWith({
      where: { streamId_userId: { streamId: 'stream-1', userId: 'stu-1' } },
    });
  });

  it('админ получает задание любого потока с _count, без проверки зачисления', async () => {
    db.session.findUnique.mockResolvedValueOnce(
      sessionWithLesson({ _count: { studentAssignments: 2 } }),
    );

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/assignments/session-1',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { assignment: { _count?: { studentAssignments: number } } };
    expect(body.assignment._count).toEqual({ studentAssignments: 2 });
    expect(db.streamEnrollment.findUnique).not.toHaveBeenCalled();
  });
});
