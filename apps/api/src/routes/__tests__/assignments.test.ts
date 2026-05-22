import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогают тестируемые ветки (DB-free).
vi.mock('@platform/db', () => ({
  prisma: {
    stream: { findUnique: vi.fn() },
    lesson: { findUnique: vi.fn() },
    assignment: { create: vi.fn() },
    streamEnrollment: { findMany: vi.fn() },
    studentAssignment: { createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    conversation: { findUnique: vi.fn(), create: vi.fn() },
    conversationEntry: { create: vi.fn() },
    lessonTeacher: { findMany: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /assignments — автовыдача зачисленным студентам', () => {
  it('создаёт назначения для всех студентов потока (status assigned)', async () => {
    db.stream.findUnique.mockResolvedValueOnce({ id: 'stream-1', status: 'active' });
    db.assignment.create.mockResolvedValueOnce({ id: 'asg-1', title: 'Задание 1' });
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
      payload: { streamId: 'stream-1', title: 'Задание 1' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.studentAssignment.createMany).toHaveBeenCalledTimes(1);

    const arg = db.studentAssignment.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(3);
    expect(arg.data).toEqual(
      expect.arrayContaining([
        { assignmentId: 'asg-1', studentId: 'u-1', status: 'assigned' },
        { assignmentId: 'asg-1', studentId: 'u-2', status: 'assigned' },
        { assignmentId: 'asg-1', studentId: 'u-3', status: 'assigned' },
      ]),
    );
    expect(arg.data.every((d: { status: string }) => d.status === 'assigned')).toBe(true);

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
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      assignmentId: 'asg-1',
      assignment: { id: 'asg-1', title: 'Задание 1', lessonId: null },
    });
    // имя проверяющего админа
    db.user.findUnique.mockResolvedValueOnce({ name: 'Преподаватель Иван' });
    db.studentAssignment.update.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'reviewed',
      studentId: 'stu-1',
      assignmentId: 'asg-1',
      fileUrl: null,
      assignment: { id: 'asg-1', title: 'Задание 1', lessonId: null },
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
  });

  it('студент НЕ может ставить status reviewed → 403', async () => {
    db.studentAssignment.findUnique.mockResolvedValueOnce({
      id: 'sa-1',
      status: 'submitted',
      studentId: 'stu-1',
      assignmentId: 'asg-1',
      assignment: { id: 'asg-1', title: 'Задание 1', lessonId: null },
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
});
