import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// DB-free: мокаем prisma — только методы, которые трогает агрегатор ленты активности.
// Источники: sessionAttendance.findMany, studentAssignment.findMany (×2: submitted/
// reviewed), videoView.findMany, materialAccess.findMany. Эти запросы выполняются
// последовательно в порядке исходника, поэтому studentAssignment.findMany управляем
// через mockResolvedValueOnce в порядке вызовов (1-й = submitted, 2-й = reviewed).
vi.mock('@platform/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    sessionAttendance: { findMany: vi.fn() },
    studentAssignment: { findMany: vi.fn() },
    videoView: { findMany: vi.fn() },
    materialAccess: { findMany: vi.fn() },
  },
}));

import { studentsRoutes } from '../students.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const STUDENT_ID = 'stu-1';
const ADMIN_ID = 'admin-1';

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(studentsRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: ADMIN_ID, role: 'admin' });
const studentToken = signAccessToken({ userId: STUDENT_ID, role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function mockStudentExists() {
  db.user.findUnique.mockResolvedValueOnce({ id: STUDENT_ID, role: 'student', deletedAt: null });
}

// Удобные фабрики «рядов» источников в форме, которую возвращает prisma select.
function attendanceRow(opts: {
  sessionId: string;
  source: 'zoom_report' | 'manual';
  status: string;
  date: Date | null;
  createdAt?: Date;
  lessonId?: string;
  streamId?: string;
  lessonTitle?: string;
  streamName?: string;
}) {
  return {
    id: `att-${opts.sessionId}-${opts.source}`,
    sessionId: opts.sessionId,
    source: opts.source,
    status: opts.status,
    createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    session: {
      id: opts.sessionId,
      date: opts.date,
      lessonId: opts.lessonId ?? 'lesson-a',
      streamId: opts.streamId ?? 'stream-a',
      lesson: { title: opts.lessonTitle ?? 'Урок A' },
      stream: { name: opts.streamName ?? 'Поток A' },
    },
  };
}

function assignmentRow(opts: { id: string; submittedAt?: Date | null; reviewedAt?: Date | null }) {
  return {
    id: opts.id,
    submittedAt: opts.submittedAt ?? null,
    reviewedAt: opts.reviewedAt ?? null,
    session: {
      lessonId: 'lesson-b',
      streamId: 'stream-b',
      lesson: { title: 'Урок B' },
      stream: { name: 'Поток B' },
    },
  };
}

function videoRow(opts: {
  id: string;
  lastWatchedAt: Date;
  watchedPercent?: number;
  completedAt?: Date | null;
}) {
  return {
    id: opts.id,
    lessonVideoId: 'lv-1',
    streamId: 'stream-c',
    watchedPercent: opts.watchedPercent ?? 50,
    completedAt: opts.completedAt ?? null,
    lastWatchedAt: opts.lastWatchedAt,
    lessonVideo: {
      id: 'lv-1',
      title: 'Видео 1',
      lessonId: 'lesson-c',
      lesson: { title: 'Урок C' },
    },
    stream: { name: 'Поток C' },
  };
}

function materialRow(opts: {
  id: string;
  accessedAt: Date;
  accessType: 'viewed' | 'downloaded';
  fileName?: string;
  lessonId?: string;
  streamId?: string;
  lessonTitle?: string;
  streamName?: string;
}) {
  return {
    id: opts.id,
    lessonId: opts.lessonId ?? 'lesson-d',
    streamId: opts.streamId ?? 'stream-d',
    fileName: opts.fileName ?? 'материал.pdf',
    accessType: opts.accessType,
    accessedAt: opts.accessedAt,
    lesson: { title: opts.lessonTitle ?? 'Урок D' },
    stream: { name: opts.streamName ?? 'Поток D' },
  };
}

// Хелпер: задать пустые ответы по всем источникам (по умолчанию).
function mockEmptySources() {
  db.sessionAttendance.findMany.mockResolvedValue([]);
  db.studentAssignment.findMany.mockResolvedValue([]);
  db.videoView.findMany.mockResolvedValue([]);
  db.materialAccess.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /students/:id/activity — доступ', () => {
  it('401 — без токена', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: `/students/${STUDENT_ID}/activity` });
    expect(res.statusCode).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('403 — роль student (не админ)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('404 — студент не найден', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(db.sessionAttendance.findMany).not.toHaveBeenCalled();
  });

  it('404 — :id указывает на admin, а не student', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'a-2', role: 'admin', deletedAt: null });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/a-2/activity`,
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 — битый before (не парсится в дату)', async () => {
    mockStudentExists();
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity?before=не-дата`,
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(db.sessionAttendance.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /students/:id/activity — happy path', () => {
  it('200 — события всех четырёх типов, отсортированы по timestamp DESC', async () => {
    mockStudentExists();
    db.sessionAttendance.findMany.mockResolvedValueOnce([
      attendanceRow({
        sessionId: 'sess-1',
        source: 'manual',
        status: 'present',
        date: new Date('2026-05-01T00:00:00Z'),
      }),
    ]);
    // 1-й вызов studentAssignment.findMany = submitted, 2-й = reviewed.
    db.studentAssignment.findMany
      .mockResolvedValueOnce([assignmentRow({ id: 'sa-1', submittedAt: new Date('2026-05-03T00:00:00Z') })])
      .mockResolvedValueOnce([assignmentRow({ id: 'sa-1', reviewedAt: new Date('2026-05-04T00:00:00Z') })]);
    db.videoView.findMany.mockResolvedValueOnce([
      videoRow({
        id: 'vv-1',
        lastWatchedAt: new Date('2026-05-02T00:00:00Z'),
        watchedPercent: 100,
        completedAt: new Date('2026-05-02T00:00:00Z'),
      }),
    ]);
    db.materialAccess.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(4);

    // Все четыре типа присутствуют.
    const types = body.items.map((e: { type: string }) => e.type);
    expect(new Set(types)).toEqual(
      new Set(['attendance', 'assignment_submitted', 'assignment_reviewed', 'video_watched']),
    );

    // Сортировка по timestamp убыванию: reviewed(05-04) > submitted(05-03) > video(05-02) > attendance(05-01).
    expect(types).toEqual([
      'assignment_reviewed',
      'assignment_submitted',
      'video_watched',
      'attendance',
    ]);
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i - 1].timestamp >= body.items[i].timestamp).toBe(true);
    }

    // Полнота полей video_watched.
    const video = body.items.find((e: { type: string }) => e.type === 'video_watched');
    expect(video).toMatchObject({
      id: 'video_watched:vv-1',
      videoId: 'lv-1',
      videoTitle: 'Видео 1',
      watchedPercent: 100,
      completed: true,
      lessonId: 'lesson-c',
      lessonTitle: 'Урок C',
      streamName: 'Поток C',
    });

    // Полнота attendance.
    const att = body.items.find((e: { type: string }) => e.type === 'attendance');
    expect(att).toMatchObject({ id: 'attendance:sess-1', status: 'present', lessonTitle: 'Урок A' });

    // Меньше limit → nextCursor null.
    expect(body.nextCursor).toBeNull();
  });

  it('200 — пустой лог → items:[], nextCursor:null', async () => {
    mockStudentExists();
    mockEmptySources();

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });
});

describe('GET /students/:id/activity — дедуп посещаемости', () => {
  it('zoom + manual в одном занятии → одно событие с manual-статусом', async () => {
    mockStudentExists();
    // У одного sessionId два ряда: zoom (present) и manual (absent). Должен остаться
    // ОДИН event с manual-статусом 'absent'.
    db.sessionAttendance.findMany.mockResolvedValueOnce([
      attendanceRow({
        sessionId: 'sess-1',
        source: 'zoom_report',
        status: 'present',
        date: new Date('2026-05-01T00:00:00Z'),
      }),
      attendanceRow({
        sessionId: 'sess-1',
        source: 'manual',
        status: 'absent',
        date: new Date('2026-05-01T00:00:00Z'),
      }),
    ]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    db.videoView.findMany.mockResolvedValueOnce([]);
    db.materialAccess.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const attendance = body.items.filter((e: { type: string }) => e.type === 'attendance');
    expect(attendance).toHaveLength(1);
    expect(attendance[0]).toMatchObject({ id: 'attendance:sess-1', status: 'absent' });
  });

  it('attendance с date=null → timestamp фолбэк на createdAt', async () => {
    mockStudentExists();
    db.sessionAttendance.findMany.mockResolvedValueOnce([
      attendanceRow({
        sessionId: 'sess-2',
        source: 'manual',
        status: 'present',
        date: null,
        createdAt: new Date('2026-04-15T12:00:00Z'),
      }),
    ]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    db.videoView.findMany.mockResolvedValueOnce([]);
    db.materialAccess.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const att = res.json().items[0];
    expect(att.timestamp).toBe('2026-04-15T12:00:00.000Z');
  });
});

describe('GET /students/:id/activity — пагинация', () => {
  it('limit < общего числа → nextCursor; следующая страница (before=nextCursor) без пересечений', async () => {
    // Готовим 4 видео-события на разных датах. Запросим страницами по 2.
    const allVideos = [
      videoRow({ id: 'v-1', lastWatchedAt: new Date('2026-05-04T00:00:00Z') }),
      videoRow({ id: 'v-2', lastWatchedAt: new Date('2026-05-03T00:00:00Z') }),
      videoRow({ id: 'v-3', lastWatchedAt: new Date('2026-05-02T00:00:00Z') }),
      videoRow({ id: 'v-4', lastWatchedAt: new Date('2026-05-01T00:00:00Z') }),
    ];

    // ── Страница 1 (limit=2, без before) ──
    mockStudentExists();
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    // Источник видео сам применяет take:limit + сортировку DESC → отдаём первые 2.
    db.videoView.findMany.mockResolvedValueOnce(allVideos.slice(0, 2));
    db.materialAccess.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res1 = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity?limit=2`,
      headers: authHeaders(adminToken),
    });

    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.items.map((e: { id: string }) => e.id)).toEqual(['video_watched:v-1', 'video_watched:v-2']);
    // Ровно limit элементов → есть nextCursor = timestamp последнего.
    expect(body1.nextCursor).toBe('2026-05-03T00:00:00.000Z');

    // ── Страница 2 (before=nextCursor) ──
    vi.clearAllMocks();
    mockStudentExists();
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    db.videoView.findMany.mockResolvedValueOnce(allVideos.slice(2, 4));
    db.materialAccess.findMany.mockResolvedValueOnce([]);

    const res2 = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity?limit=2&before=${encodeURIComponent(body1.nextCursor)}`,
      headers: authHeaders(adminToken),
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.items.map((e: { id: string }) => e.id)).toEqual(['video_watched:v-3', 'video_watched:v-4']);

    // Проверяем, что фильтр before проброшен в запрос видео.
    const videoWhere = db.videoView.findMany.mock.calls[0][0].where;
    expect(videoWhere.lastWatchedAt).toEqual({ lt: new Date(body1.nextCursor) });

    // Без пересечений между страницами.
    const ids1 = new Set(body1.items.map((e: { id: string }) => e.id));
    const ids2 = body2.items.map((e: { id: string }) => e.id);
    expect(ids2.some((id: string) => ids1.has(id))).toBe(false);

    // На последней странице элементов меньше limit? Здесь ровно 2 = limit → nextCursor
    // не null (страж: следующий запрос вернёт пусто). Проверяем именно эту семантику.
    expect(body2.nextCursor).toBe('2026-05-01T00:00:00.000Z');
  });

  it('limit клампится к 1..100 (limit=999 → take не превышает 100)', async () => {
    mockStudentExists();
    mockEmptySources();

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity?limit=999`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    // Видео-источник берёт take:limit — после клампа limit=100.
    expect(db.videoView.findMany.mock.calls[0][0].take).toBe(100);
  });
});

describe('GET /students/:id/activity — материалы (MaterialAccess)', () => {
  it('200 — обращения к материалам попадают в ленту с правильными type/materialName/lessonTitle/streamName', async () => {
    mockStudentExists();
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    db.videoView.findMany.mockResolvedValueOnce([]);
    db.materialAccess.findMany.mockResolvedValueOnce([
      materialRow({
        id: 'ma-1',
        accessedAt: new Date('2026-05-10T00:00:00Z'),
        accessType: 'downloaded',
        fileName: 'конспект.pdf',
        lessonTitle: 'Урок D',
        streamName: 'Поток D',
      }),
      materialRow({
        id: 'ma-2',
        accessedAt: new Date('2026-05-09T00:00:00Z'),
        accessType: 'viewed',
        fileName: 'слайды.pptx',
      }),
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);

    const downloaded = body.items.find((e: { type: string }) => e.type === 'material_downloaded');
    expect(downloaded).toMatchObject({
      id: 'material_downloaded:ma-1',
      type: 'material_downloaded',
      materialName: 'конспект.pdf',
      lessonId: 'lesson-d',
      lessonTitle: 'Урок D',
      streamId: 'stream-d',
      streamName: 'Поток D',
      timestamp: '2026-05-10T00:00:00.000Z',
    });

    const viewed = body.items.find((e: { type: string }) => e.type === 'material_viewed');
    expect(viewed).toMatchObject({
      id: 'material_viewed:ma-2',
      type: 'material_viewed',
      materialName: 'слайды.pptx',
    });
  });

  it('200 — материалы корректно сортируются вперемешку с другими событиями по времени', async () => {
    mockStudentExists();
    db.sessionAttendance.findMany.mockResolvedValueOnce([
      attendanceRow({
        sessionId: 'sess-1',
        source: 'manual',
        status: 'present',
        date: new Date('2026-05-01T00:00:00Z'),
      }),
    ]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    db.videoView.findMany.mockResolvedValueOnce([
      videoRow({ id: 'vv-1', lastWatchedAt: new Date('2026-05-03T00:00:00Z') }),
    ]);
    db.materialAccess.findMany.mockResolvedValueOnce([
      materialRow({ id: 'ma-1', accessedAt: new Date('2026-05-04T00:00:00Z'), accessType: 'viewed' }),
      materialRow({ id: 'ma-2', accessedAt: new Date('2026-05-02T00:00:00Z'), accessType: 'downloaded' }),
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const types = res.json().items.map((e: { type: string }) => e.type);
    // material(05-04) > video(05-03) > material(05-02) > attendance(05-01).
    expect(types).toEqual(['material_viewed', 'video_watched', 'material_downloaded', 'attendance']);
  });

  it('200 — before-курсор проброшен в запрос materialAccess (accessedAt < before)', async () => {
    mockStudentExists();
    mockEmptySources();

    const before = '2026-05-03T00:00:00.000Z';
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity?limit=2&before=${encodeURIComponent(before)}`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const where = db.materialAccess.findMany.mock.calls[0][0].where;
    expect(where.studentId).toBe(STUDENT_ID);
    expect(where.accessedAt).toEqual({ lt: new Date(before) });
    // take ограничен limit (как у остальных источников).
    expect(db.materialAccess.findMany.mock.calls[0][0].take).toBe(2);
  });

  it('200 — материалы участвуют в курсор-пагинации (nextCursor по последнему событию)', async () => {
    mockStudentExists();
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);
    db.studentAssignment.findMany.mockResolvedValue([]);
    db.videoView.findMany.mockResolvedValueOnce([]);
    db.materialAccess.findMany.mockResolvedValueOnce([
      materialRow({ id: 'ma-1', accessedAt: new Date('2026-05-04T00:00:00Z'), accessType: 'viewed' }),
      materialRow({ id: 'ma-2', accessedAt: new Date('2026-05-03T00:00:00Z'), accessType: 'viewed' }),
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/students/${STUDENT_ID}/activity?limit=2`,
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((e: { id: string }) => e.id)).toEqual([
      'material_viewed:ma-1',
      'material_viewed:ma-2',
    ]);
    // Ровно limit → nextCursor = timestamp последнего.
    expect(body.nextCursor).toBe('2026-05-03T00:00:00.000Z');
  });
});
