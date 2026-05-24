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
    session: { upsert: vi.fn(), findUnique: vi.fn() },
    streamEnrollment: { findMany: vi.fn() },
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
    // Преподавателей у урока нет → фолбэк на админов (notifyMany).
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
    // Преподавателей у урока нет → фолбэк на админов (notifyMany).
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
