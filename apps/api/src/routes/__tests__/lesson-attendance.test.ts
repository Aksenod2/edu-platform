import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогают эндпоинты посещаемости и lib
// синка (DB-free). Занятие = Session(streamId × lessonId); состав потока —
// StreamEnrollment; записи — SessionAttendance (дедуп вручную: findFirst → update/create).
vi.mock('@platform/db', () => ({
  prisma: {
    lesson: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    stream: { findUnique: vi.fn() },
    session: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    streamEnrollment: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    studentAssignment: { groupBy: vi.fn() },
    sessionAttendance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    lessonVideo: { findMany: vi.fn() },
    programLesson: { findMany: vi.fn() },
    lessonTeacher: { findMany: vi.fn() },
  },
  Prisma: {},
}));

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

// Zoom: getZoomAccessToken/canCreateMeeting — для resync через реальную lib
// zoom-attendance (её НЕ мокаем, чтобы покрыть синк + дедуп). fetch замокан ниже.
vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(() => Promise.resolve(false)),
  canCreateMeeting: vi.fn(() => Promise.resolve(true)),
  getZoomAccessToken: vi.fn(() => Promise.resolve('zoom-token')),
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
const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Хелпер: мок ответа Zoom report (одна страница).
function zoomReportResponse(participants: unknown[], nextPageToken = '') {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ participants, next_page_token: nextPageToken }),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /lessons/:id/attendance — сводка посещаемости', () => {
  it('admin: 200, счётчики и records (manual приоритетнее zoom_report)', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-1' });
    db.streamEnrollment.count.mockResolvedValueOnce(3);
    db.sessionAttendance.findMany.mockResolvedValueOnce([
      {
        id: 'a1',
        userId: 'u1',
        source: 'zoom_report',
        status: 'present',
        displayName: 'Иван',
        email: 'ivan@x.ru',
        joinedAt: new Date('2026-05-24T10:00:00Z'),
        leftAt: new Date('2026-05-24T11:00:00Z'),
        durationSec: 3600,
        updatedAt: new Date('2026-05-24T12:00:00Z'),
        user: { name: 'Иван Петров' },
      },
      {
        // Ручная отметка absent у того же студента — должна перебить zoom present.
        id: 'a2',
        userId: 'u1',
        source: 'manual',
        status: 'absent',
        displayName: null,
        email: null,
        joinedAt: null,
        leftAt: null,
        durationSec: null,
        updatedAt: new Date('2026-05-24T13:00:00Z'),
        user: { name: 'Иван Петров' },
      },
      {
        // Несопоставленный гость.
        id: 'a3',
        userId: null,
        source: 'zoom_report',
        status: 'present',
        displayName: 'Гость',
        email: 'guest@x.ru',
        joinedAt: null,
        leftAt: null,
        durationSec: 100,
        updatedAt: new Date('2026-05-24T11:30:00Z'),
        user: null,
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/attendance?streamId=stream-1',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe('session-1');
    expect(body.streamId).toBe('stream-1');
    expect(body.enrolledCount).toBe(3);
    // u1: manual absent перебивает zoom present → 0 present, 1 absent.
    expect(body.presentCount).toBe(0);
    expect(body.absentCount).toBe(1);
    expect(body.unmatchedCount).toBe(1);
    // lastSyncedAt = макс updatedAt среди zoom_report записей (a1=12:00 > a3=11:30).
    expect(body.lastSyncedAt).toBe(new Date('2026-05-24T12:00:00Z').toISOString());
    expect(body.records).toHaveLength(3);
    expect(body.records[0]).toMatchObject({
      id: 'a1',
      userId: 'u1',
      studentName: 'Иван Петров',
      matched: true,
    });
    expect(body.records[2]).toMatchObject({ id: 'a3', matched: false, studentName: null });

    expect(db.session.findUnique.mock.calls[0][0].where).toEqual({
      streamId_lessonId: { streamId: 'stream-1', lessonId: 'lesson-1' },
    });
  });

  it('admin: 404 если занятия (Session) нет', async () => {
    db.session.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-x/attendance?streamId=stream-x',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(db.sessionAttendance.findMany).not.toHaveBeenCalled();
  });

  it('admin: 400 без streamId', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/attendance',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });

  it('требует роль admin: студент → 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/attendance?streamId=stream-1',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('требует аутентификацию: без токена → 401', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/lesson-1/attendance?streamId=stream-1',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /lessons/:id/attendance/mark — ручная отметка', () => {
  it('admin: создаёт ручную запись, если её нет', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.sessionAttendance.findFirst.mockResolvedValueOnce(null); // ручного ряда нет
    db.sessionAttendance.create.mockResolvedValueOnce({ id: 'new-1' });
    // Для финальной сводки:
    db.streamEnrollment.count.mockResolvedValueOnce(2);
    db.sessionAttendance.findMany.mockResolvedValueOnce([
      {
        id: 'new-1',
        userId: 'u1',
        source: 'manual',
        status: 'present',
        displayName: null,
        email: null,
        joinedAt: null,
        leftAt: null,
        durationSec: null,
        updatedAt: new Date('2026-05-24T13:00:00Z'),
        user: { name: 'Иван' },
      },
    ]);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/mark',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1', userId: 'u1', status: 'present' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.sessionAttendance.create).toHaveBeenCalledTimes(1);
    expect(db.sessionAttendance.create.mock.calls[0][0].data).toEqual({
      sessionId: 'session-1',
      userId: 'u1',
      source: 'manual',
      status: 'present',
    });
    expect(db.sessionAttendance.update).not.toHaveBeenCalled();
    expect(res.json().presentCount).toBe(1);
  });

  it('admin: обновляет существующую ручную запись', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.sessionAttendance.findFirst.mockResolvedValueOnce({ id: 'exist-1' });
    db.sessionAttendance.update.mockResolvedValueOnce({ id: 'exist-1' });
    db.streamEnrollment.count.mockResolvedValueOnce(2);
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/mark',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1', userId: 'u1', status: 'absent' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.sessionAttendance.update).toHaveBeenCalledTimes(1);
    expect(db.sessionAttendance.update.mock.calls[0][0]).toEqual({
      where: { id: 'exist-1' },
      data: { status: 'absent' },
    });
    expect(db.sessionAttendance.create).not.toHaveBeenCalled();
  });

  it('admin: 400 при недопустимом status', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/mark',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1', userId: 'u1', status: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });

  it('admin: 400 если студент не зачислен в поток', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-1' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/mark',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1', userId: 'u9', status: 'present' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Студент не зачислен в группу' });
  });

  it('требует роль admin: студент → 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/mark',
      headers: authHeaders(studentToken),
      payload: { streamId: 'stream-1', userId: 'u1', status: 'present' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /lessons/:id/attendance/resync — забор из Zoom', () => {
  it('admin: успех — забирает участников, сопоставляет по email, возвращает ok:true', async () => {
    db.session.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      streamId: 'stream-1',
      zoomMeetingId: '999',
      lessonId: 'lesson-1',
    });
    // Преподавателей у урока нет → роут падает на фолбэк-админа (canCreateMeeting=true).
    db.lessonTeacher.findMany.mockResolvedValue([]);
    // Состав потока для сопоставления по email (case-insensitive).
    db.streamEnrollment.findMany.mockResolvedValueOnce([
      { user: { id: 'u1', email: 'Ivan@X.ru' } },
    ]);
    // Дедуп: zoom-ряда ещё нет → create.
    db.sessionAttendance.findFirst.mockResolvedValue(null);
    db.sessionAttendance.create.mockResolvedValue({ id: 'created' });

    // Zoom report API: один участник (совпадает по email) + один гость.
    const fetchMock = vi.fn().mockResolvedValue(
      zoomReportResponse([
        {
          id: 'p1',
          name: 'Иван',
          user_email: 'ivan@x.ru',
          join_time: '2026-05-24T10:00:00Z',
          leave_time: '2026-05-24T11:00:00Z',
          duration: 3600,
        },
        {
          id: 'p2',
          name: 'Гость',
          user_email: 'guest@x.ru',
          join_time: '2026-05-24T10:05:00Z',
          leave_time: '2026-05-24T10:30:00Z',
          duration: 1500,
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    // Финальная сводка.
    db.streamEnrollment.count.mockResolvedValueOnce(1);
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/resync',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // Два участника → два create (оба новые).
    expect(db.sessionAttendance.create).toHaveBeenCalledTimes(2);
    // Первый участник сопоставлен по email (case-insensitive) → userId='u1'.
    const firstCreate = db.sessionAttendance.create.mock.calls[0][0].data;
    expect(firstCreate.userId).toBe('u1');
    expect(firstCreate.source).toBe('zoom_report');
    expect(firstCreate.zoomParticipantId).toBe('p1');
    // Второй — гость без совпадения → userId=null.
    const secondCreate = db.sessionAttendance.create.mock.calls[1][0].data;
    expect(secondCreate.userId).toBeNull();
    // Запрос к Zoom report API.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/report/meetings/999/participants',
    );
  });

  it('admin: пересинк НЕ затирает ручную привязку гостя (регрессия)', async () => {
    db.session.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      streamId: 'stream-1',
      zoomMeetingId: '999',
      lessonId: 'lesson-1',
    });
    db.lessonTeacher.findMany.mockResolvedValue([]);
    // В составе нет совпадения по email гостя — авто-сопоставление дало бы null.
    db.streamEnrollment.findMany.mockResolvedValueOnce([]);
    // Зум-ряд гостя УЖЕ есть и сопоставлен вручную (userId='manual-student').
    db.sessionAttendance.findFirst.mockResolvedValue({
      id: 'a1',
      userId: 'manual-student',
    });
    db.sessionAttendance.update.mockResolvedValue({ id: 'a1' });

    const fetchMock = vi.fn().mockResolvedValue(
      zoomReportResponse([
        {
          id: 'p2',
          name: 'Гость',
          user_email: 'guest@x.ru',
          join_time: '2026-05-24T10:05:00Z',
          leave_time: '2026-05-24T10:30:00Z',
          duration: 1500,
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    db.streamEnrollment.count.mockResolvedValueOnce(1);
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/resync',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1' },
    });

    expect(res.statusCode).toBe(200);
    // Ряд уже был → update, не create.
    expect(db.sessionAttendance.update).toHaveBeenCalledTimes(1);
    expect(db.sessionAttendance.create).not.toHaveBeenCalled();
    // Ручная привязка сохранена (не сброшена в null при пересинке).
    expect(db.sessionAttendance.update.mock.calls[0][0].data.userId).toBe(
      'manual-student',
    );
    // А прочие поля из Zoom обновились.
    expect(db.sessionAttendance.update.mock.calls[0][0].data.displayName).toBe('Гость');
  });

  it('admin: Zoom 403 (scope не выдан) → ok:false без падения', async () => {
    db.session.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      streamId: 'stream-1',
      zoomMeetingId: '999',
      lessonId: 'lesson-1',
    });
    db.lessonTeacher.findMany.mockResolvedValue([]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'forbidden' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/resync',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('scope');
    expect(db.sessionAttendance.create).not.toHaveBeenCalled();
  });

  it('admin: у занятия нет встречи Zoom → ok:false reason "нет встречи Zoom"', async () => {
    db.session.findUnique.mockResolvedValueOnce({
      id: 'session-1',
      streamId: 'stream-1',
      zoomMeetingId: null,
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/resync',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, reason: 'нет встречи Zoom' });
  });

  it('admin: 404 если занятия нет', async () => {
    db.session.findUnique.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/resync',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('требует роль admin: студент → 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/lesson-1/attendance/resync',
      headers: authHeaders(studentToken),
      payload: { streamId: 'stream-1' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /lessons/:id/attendance/:attendanceId/match — привязка гостя', () => {
  it('admin: привязывает запись к студенту потока', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-1' });
    db.sessionAttendance.findFirst.mockResolvedValueOnce({ id: 'a3' });
    db.streamEnrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
    db.sessionAttendance.update.mockResolvedValueOnce({ id: 'a3' });
    db.streamEnrollment.count.mockResolvedValueOnce(2);
    db.sessionAttendance.findMany.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/lessons/lesson-1/attendance/a3/match',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1', userId: 'u1' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.sessionAttendance.update.mock.calls[0][0]).toEqual({
      where: { id: 'a3' },
      data: { userId: 'u1' },
    });
  });

  it('admin: 404 если записи нет', async () => {
    db.session.findUnique.mockResolvedValueOnce({ id: 'session-1' });
    db.sessionAttendance.findFirst.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/lessons/lesson-1/attendance/zzz/match',
      headers: authHeaders(adminToken),
      payload: { streamId: 'stream-1', userId: 'u1' },
    });
    expect(res.statusCode).toBe(404);
  });
});
