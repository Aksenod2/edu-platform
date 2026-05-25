import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// DB-free: мокаем prisma — только методы, которые трогают роуты «Динамики ученика».
vi.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    studentDynamic: { findUnique: vi.fn(), upsert: vi.fn() },
    studentDynamicEntry: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { studentDynamicRoutes } from '../student-dynamic.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const STUDENT_ID = 'stu-1';
const ENTRY_ID = 'entry-1';
const ADMIN_ID = 'admin-1';

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(studentDynamicRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: ADMIN_ID, role: 'admin' });
const studentToken = signAccessToken({ userId: STUDENT_ID, role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Заглушка «студент существует» для ensureStudent (user.findUnique).
function mockStudentExists() {
  db.user.findUnique.mockResolvedValueOnce({ id: STUDENT_ID, role: 'student', deletedAt: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /students/:id/dynamic', () => {
  it('200 — roadmap + лента записей (desc по createdAt)', async () => {
    mockStudentExists();
    db.studentDynamic.findUnique.mockResolvedValueOnce({
      roadmap: '## С чем пришёл\nничего',
      updatedAt: new Date('2026-05-10T00:00:00Z'),
      updatedBy: { name: 'Препод' },
    });
    db.studentDynamicEntry.findMany.mockResolvedValueOnce([
      {
        id: ENTRY_ID,
        content: 'Запись',
        source: 'manual',
        author: { name: 'Препод' },
        lessonId: null,
        sessionId: null,
        createdAt: new Date('2026-05-11T00:00:00Z'),
        updatedAt: new Date('2026-05-11T00:00:00Z'),
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/dynamic`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roadmap).toBe('## С чем пришёл\nничего');
    expect(body.updatedByName).toBe('Препод');
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      id: ENTRY_ID,
      content: 'Запись',
      source: 'manual',
      authorName: 'Препод',
    });
    // Лента запрашивается desc по createdAt.
    expect(db.studentDynamicEntry.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('200 — roadmap-шапки ещё нет → roadmap:null, entries:[]', async () => {
    mockStudentExists();
    db.studentDynamic.findUnique.mockResolvedValueOnce(null);
    db.studentDynamicEntry.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/dynamic`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roadmap).toBeNull();
    expect(body.updatedByName).toBeNull();
    expect(body.entries).toEqual([]);
  });

  it('404 — студент не найден', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/dynamic`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
    expect(db.studentDynamic.findUnique).not.toHaveBeenCalled();
  });

  it('404 — :id указывает на admin, а не student', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'a-2', role: 'admin', deletedAt: null });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/a-2/dynamic`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('403 — студент не имеет доступа', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/dynamic`,
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('PUT /students/:id/dynamic/roadmap', () => {
  it('200 — upsert roadmap, updatedById=admin', async () => {
    mockStudentExists();
    db.studentDynamic.upsert.mockResolvedValueOnce({
      roadmap: 'новый roadmap',
      updatedAt: new Date('2026-05-12T00:00:00Z'),
      updatedBy: { name: 'Препод' },
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${STUDENT_ID}/dynamic/roadmap`,
      headers: authHeaders(adminToken),
      payload: { roadmap: 'новый roadmap' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ roadmap: 'новый roadmap', updatedByName: 'Препод' });
    const arg = db.studentDynamic.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ studentId: STUDENT_ID });
    expect(arg.create).toMatchObject({ studentId: STUDENT_ID, roadmap: 'новый roadmap', updatedById: ADMIN_ID });
    expect(arg.update).toMatchObject({ roadmap: 'новый roadmap', updatedById: ADMIN_ID });
  });

  it('400 — roadmap не строка', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${STUDENT_ID}/dynamic/roadmap`,
      headers: authHeaders(adminToken),
      payload: { roadmap: 123 },
    });

    expect(res.statusCode).toBe(400);
    expect(db.studentDynamic.upsert).not.toHaveBeenCalled();
  });

  it('400 — roadmap превышает лимит длины', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${STUDENT_ID}/dynamic/roadmap`,
      headers: authHeaders(adminToken),
      payload: { roadmap: 'я'.repeat(50_001) },
    });

    expect(res.statusCode).toBe(400);
    expect(db.studentDynamic.upsert).not.toHaveBeenCalled();
  });

  it('404 — студент не найден (валидный body)', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${STUDENT_ID}/dynamic/roadmap`,
      headers: authHeaders(adminToken),
      payload: { roadmap: 'текст' },
    });

    expect(res.statusCode).toBe(404);
    expect(db.studentDynamic.upsert).not.toHaveBeenCalled();
  });

  it('403 — студент не имеет доступа', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/students/${STUDENT_ID}/dynamic/roadmap`,
      headers: authHeaders(studentToken),
      payload: { roadmap: 'текст' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /students/:id/dynamic/entries', () => {
  it('201 — создаёт запись (authorId=admin, source=manual)', async () => {
    mockStudentExists();
    db.studentDynamicEntry.create.mockResolvedValueOnce({
      id: ENTRY_ID,
      content: 'Прогресс за неделю',
      source: 'manual',
      author: { name: 'Препод' },
      lessonId: 'lesson-9',
      sessionId: null,
      createdAt: new Date('2026-05-13T00:00:00Z'),
      updatedAt: new Date('2026-05-13T00:00:00Z'),
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT_ID}/dynamic/entries`,
      headers: authHeaders(adminToken),
      payload: { content: 'Прогресс за неделю', lessonId: 'lesson-9' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().entry).toMatchObject({
      id: ENTRY_ID,
      content: 'Прогресс за неделю',
      source: 'manual',
      authorName: 'Препод',
      lessonId: 'lesson-9',
    });
    const data = db.studentDynamicEntry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      studentId: STUDENT_ID,
      authorId: ADMIN_ID,
      source: 'manual',
      content: 'Прогресс за неделю',
      lessonId: 'lesson-9',
    });
  });

  it('400 — content пустой', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT_ID}/dynamic/entries`,
      headers: authHeaders(adminToken),
      payload: { content: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.studentDynamicEntry.create).not.toHaveBeenCalled();
  });

  it('400 — content превышает лимит длины', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT_ID}/dynamic/entries`,
      headers: authHeaders(adminToken),
      payload: { content: 'я'.repeat(50_001) },
    });

    expect(res.statusCode).toBe(400);
    expect(db.studentDynamicEntry.create).not.toHaveBeenCalled();
  });

  it('404 — студент не найден', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT_ID}/dynamic/entries`,
      headers: authHeaders(adminToken),
      payload: { content: 'текст' },
    });

    expect(res.statusCode).toBe(404);
    expect(db.studentDynamicEntry.create).not.toHaveBeenCalled();
  });

  it('403 — студент не имеет доступа', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/students/${STUDENT_ID}/dynamic/entries`,
      headers: authHeaders(studentToken),
      payload: { content: 'текст' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /students/:id/dynamic/entries/:entryId', () => {
  it('200 — обновляет content записи своего студента', async () => {
    db.studentDynamicEntry.findUnique.mockResolvedValueOnce({ id: ENTRY_ID, studentId: STUDENT_ID });
    db.studentDynamicEntry.update.mockResolvedValueOnce({
      id: ENTRY_ID,
      content: 'Исправлено',
      source: 'manual',
      author: { name: 'Препод' },
      lessonId: null,
      sessionId: null,
      createdAt: new Date('2026-05-13T00:00:00Z'),
      updatedAt: new Date('2026-05-14T00:00:00Z'),
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(adminToken),
      payload: { content: 'Исправлено' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().entry).toMatchObject({ id: ENTRY_ID, content: 'Исправлено' });
    expect(db.studentDynamicEntry.update.mock.calls[0][0]).toMatchObject({
      where: { id: ENTRY_ID },
      data: { content: 'Исправлено' },
    });
  });

  it('404 — запись принадлежит другому студенту', async () => {
    db.studentDynamicEntry.findUnique.mockResolvedValueOnce({ id: ENTRY_ID, studentId: 'другой-студент' });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(adminToken),
      payload: { content: 'Исправлено' },
    });

    expect(res.statusCode).toBe(404);
    expect(db.studentDynamicEntry.update).not.toHaveBeenCalled();
  });

  it('404 — запись не существует', async () => {
    db.studentDynamicEntry.findUnique.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(adminToken),
      payload: { content: 'Исправлено' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('400 — content пустой', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(adminToken),
      payload: { content: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.studentDynamicEntry.findUnique).not.toHaveBeenCalled();
  });

  it('403 — студент не имеет доступа', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(studentToken),
      payload: { content: 'текст' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /students/:id/dynamic/entries/:entryId', () => {
  it('200 — удаляет запись своего студента', async () => {
    db.studentDynamicEntry.findUnique.mockResolvedValueOnce({ id: ENTRY_ID, studentId: STUDENT_ID });
    db.studentDynamicEntry.delete.mockResolvedValueOnce({ id: ENTRY_ID });

    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.studentDynamicEntry.delete.mock.calls[0][0]).toEqual({ where: { id: ENTRY_ID } });
  });

  it('404 — запись принадлежит другому студенту', async () => {
    db.studentDynamicEntry.findUnique.mockResolvedValueOnce({ id: ENTRY_ID, studentId: 'другой-студент' });

    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
    expect(db.studentDynamicEntry.delete).not.toHaveBeenCalled();
  });

  it('404 — запись не существует', async () => {
    db.studentDynamicEntry.findUnique.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('403 — студент не имеет доступа', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/students/${STUDENT_ID}/dynamic/entries/${ENTRY_ID}`,
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
  });
});
