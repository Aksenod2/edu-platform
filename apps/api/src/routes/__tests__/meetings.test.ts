import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// DB-free: мокаем prisma — только модели, которые трогает роут встреч 1-на-1.
vi.mock('@platform/db', () => ({
  prisma: {
    meeting: {
      create: vi.fn(),
      findMany: vi.fn(() => Promise.resolve([])),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findFirst: vi.fn() },
  },
}));

// Общие обработчики записи/итогов/транскрипта мокаем — тут проверяем РОУТ (изоляция,
// валидация, форма ответа), а не сам забор из Zoom (он покрыт в zoom-recording.test).
vi.mock('../../lib/zoom-recording.js', () => ({
  processRecordingForSession: vi.fn(() => Promise.resolve('ready')),
  processSummaryForSession: vi.fn(() => Promise.resolve('ready')),
  processTranscriptForSession: vi.fn(() => Promise.resolve('ready')),
}));

// Zoom-интеграция мокается: создание/удаление встречи best-effort. По умолчанию
// интеграции «нет» — встреча создаётся без ссылки (проверяем устойчивость).
vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(() => Promise.resolve(false)),
  canCreateMeeting: vi.fn(() => Promise.resolve(false)),
  deleteZoomMeeting: vi.fn(() => Promise.resolve()),
}));

// S3 — для транскрипт-роута (тут не углубляемся, но импорт должен резолвиться).
vi.mock('../../lib/s3.js', () => ({
  getFileUrl: vi.fn(() => Promise.resolve('https://files.example/url')),
  readFileText: vi.fn(() => Promise.resolve('текст')),
}));

import { meetingRoutes } from '../meetings.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import {
  createZoomMeeting,
  canCreateMeeting,
  deleteZoomMeeting,
} from '../../lib/zoom.js';
import { getFileUrl } from '../../lib/s3.js';
import {
  processRecordingForSession,
  processSummaryForSession,
  processTranscriptForSession,
} from '../../lib/zoom-recording.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockCreateZoom = vi.mocked(createZoomMeeting);
const mockCanCreate = vi.mocked(canCreateMeeting);
const mockDeleteZoom = vi.mocked(deleteZoomMeeting);
const mockGetFileUrl = vi.mocked(getFileUrl);
const mockProcessRecording = vi.mocked(processRecordingForSession);
const mockProcessSummary = vi.mocked(processSummaryForSession);
const mockProcessTranscript = vi.mocked(processTranscriptForSession);

const TEACHER_ID = 'teacher-1';
const STUDENT_A = 'student-a';
const STUDENT_B = 'student-b';

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(meetingRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: TEACHER_ID, role: 'admin' });
const otherAdminToken = signAccessToken({ userId: 'teacher-2', role: 'admin' });
const studentAToken = signAccessToken({ userId: STUDENT_A, role: 'student' });
const studentBToken = signAccessToken({ userId: STUDENT_B, role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Полная строка Meeting (форма meetingSelect) с дефолтами; перекрываем по месту.
function meetingRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    teacherId: TEACHER_ID,
    studentId: STUDENT_A,
    title: 'Разбор',
    status: 'planned',
    date: new Date('2026-07-01T00:00:00.000Z'),
    startTime: '10:00',
    meetingUrl: null,
    videoUrl: null,
    videoKey: null,
    zoomMeetingId: null,
    recordingStatus: null,
    recordingError: 'внутренняя ошибка скачивания',
    summary: 'итоги встречи',
    summarySource: 'zoom_ai',
    summaryStatus: 'ready',
    transcriptStatus: 'ready',
    transcriptError: null,
    transcriptRequestedAt: new Date('2026-07-01T11:00:00.000Z'),
    recordingRequestedAt: null,
    summaryRequestedAt: null,
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: new Date('2026-07-01T09:00:00.000Z'),
    teacher: { id: TEACHER_ID, name: 'Препод' },
    student: { id: STUDENT_A, name: 'Студент А' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanCreate.mockResolvedValue(false);
});

describe('POST /meetings — создание встречи 1-на-1 (admin)', () => {
  it('создаёт встречу с teacherId = текущий админ; без Zoom-интеграции — без ссылки', async () => {
    db.user.findFirst.mockResolvedValue({ id: STUDENT_A, name: 'Студент А' });
    db.meeting.create.mockResolvedValue(meetingRow({ meetingUrl: null }));

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeaders(adminToken),
      payload: { studentId: STUDENT_A, date: '2026-07-01', startTime: '10:00', title: 'Разбор' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe('m-1');
    expect(body.teacherId).toBe(TEACHER_ID);
    expect(body.studentId).toBe(STUDENT_A);
    // teacherId в data create — текущий админ.
    expect(db.meeting.create).toHaveBeenCalledTimes(1);
    expect(db.meeting.create.mock.calls[0][0].data.teacherId).toBe(TEACHER_ID);
    // Zoom не создавался (интеграции нет).
    expect(mockCreateZoom).not.toHaveBeenCalled();
  });

  it('best-effort Zoom: при рабочей интеграции пишет meetingUrl/zoomMeetingId', async () => {
    db.user.findFirst.mockResolvedValue({ id: STUDENT_A, name: 'Студент А' });
    mockCanCreate.mockResolvedValue(true);
    mockCreateZoom.mockResolvedValue({ joinUrl: 'https://zoom.us/j/1', meetingId: '999' });
    db.meeting.create.mockResolvedValue(
      meetingRow({ meetingUrl: 'https://zoom.us/j/1', zoomMeetingId: '999' }),
    );

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeaders(adminToken),
      payload: { studentId: STUDENT_A, date: '2026-07-01', startTime: '10:00' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateZoom).toHaveBeenCalledTimes(1);
    const data = db.meeting.create.mock.calls[0][0].data;
    expect(data.meetingUrl).toBe('https://zoom.us/j/1');
    expect(data.zoomMeetingId).toBe('999');
  });

  it('студент не может создавать встречу (403)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeaders(studentAToken),
      payload: { studentId: STUDENT_A, date: '2026-07-01' },
    });
    expect(res.statusCode).toBe(403);
    expect(db.meeting.create).not.toHaveBeenCalled();
  });

  it('400 при отсутствии studentId / некорректной дате', async () => {
    const app = buildApp();
    const noStudent = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeaders(adminToken),
      payload: { date: '2026-07-01' },
    });
    expect(noStudent.statusCode).toBe(400);

    const badDate = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeaders(adminToken),
      payload: { studentId: STUDENT_A, date: '01.07.2026' },
    });
    expect(badDate.statusCode).toBe(400);
  });

  it('404 если студент не найден', async () => {
    db.user.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeaders(adminToken),
      payload: { studentId: 'nope', date: '2026-07-01', startTime: '10:00' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 если не указано время начала (startTime обязателен для встречи)', async () => {
    db.user.findFirst.mockResolvedValue({ id: STUDENT_A, name: 'Студент А' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeaders(adminToken),
      payload: { studentId: STUDENT_A, date: '2026-07-01' },
    });
    expect(res.statusCode).toBe(400);
    // БД не трогаем — встречу без времени не создаём.
    expect(db.meeting.create).not.toHaveBeenCalled();
  });
});

describe('GET /meetings — список с изоляцией two-party', () => {
  it('admin видит свои (WHERE teacherId=me)', async () => {
    db.meeting.findMany.mockResolvedValue([meetingRow()]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(db.meeting.findMany.mock.calls[0][0].where).toEqual({ teacherId: TEACHER_ID });
    // Админ-преподаватель видит полную проекцию (есть recordingError/транскрипт).
    const m = res.json().meetings[0];
    expect(m).toHaveProperty('recordingError');
    expect(m).toHaveProperty('transcriptStatus');
  });

  it('student видит только свои (WHERE studentId=me), урезанная проекция', async () => {
    db.meeting.findMany.mockResolvedValue([meetingRow()]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings',
      headers: authHeaders(studentAToken),
    });
    expect(res.statusCode).toBe(200);
    expect(db.meeting.findMany.mock.calls[0][0].where).toEqual({ studentId: STUDENT_A });
    const m = res.json().meetings[0];
    // Урезано: нет recordingError и полей транскрипта.
    expect(m).not.toHaveProperty('recordingError');
    expect(m).not.toHaveProperty('transcriptStatus');
    expect(m).not.toHaveProperty('transcriptError');
    expect(m).not.toHaveProperty('transcriptRequestedAt');
    // Но итоги встречи студенту видны.
    expect(m.summary).toBe('итоги встречи');
  });

  it('студент A не видит встречу студента B (фильтр на уровне WHERE)', async () => {
    // findMany для студента B вернёт пусто (его встреч нет) — встреча A не утечёт.
    db.meeting.findMany.mockResolvedValue([]);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings',
      headers: authHeaders(studentBToken),
    });
    expect(res.statusCode).toBe(200);
    expect(db.meeting.findMany.mock.calls[0][0].where).toEqual({ studentId: STUDENT_B });
    expect(res.json().meetings).toEqual([]);
  });
});

describe('GET /meetings/:id — деталь, изоляция и проекция', () => {
  it('teacher видит полную проекцию', async () => {
    db.meeting.findUnique.mockResolvedValue(meetingRow());
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m).toHaveProperty('recordingError');
    expect(m).toHaveProperty('transcriptStatus');
  });

  it('student-участник — урезанная проекция (без recordingError/транскрипта)', async () => {
    db.meeting.findUnique.mockResolvedValue(meetingRow());
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1',
      headers: authHeaders(studentAToken),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m).not.toHaveProperty('recordingError');
    expect(m).not.toHaveProperty('transcriptStatus');
    expect(m.summary).toBe('итоги встречи');
  });

  it('чужой студент (B) → 404', async () => {
    db.meeting.findUnique.mockResolvedValue(meetingRow()); // встреча teacher↔A
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1',
      headers: authHeaders(studentBToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('другой админ (не teacher встречи) → 404', async () => {
    db.meeting.findUnique.mockResolvedValue(meetingRow());
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1',
      headers: authHeaders(otherAdminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('несуществующая встреча → 404', async () => {
    db.meeting.findUnique.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/nope',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Проекция записи — recordingFileUrl (подписанный S3-URL по videoKey)', () => {
  it('videoKey задан → recordingFileUrl = подписанный URL (admin)', async () => {
    db.meeting.findUnique.mockResolvedValue(meetingRow({ videoKey: 'meetings/m-1/rec.mp4' }));
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    // Подписание делегировано getFileUrl (замокан) — URL приходит наружу.
    expect(m.recordingFileUrl).toBe('https://files.example/url');
    expect(mockGetFileUrl).toHaveBeenCalledWith('meetings/m-1/rec.mp4');
  });

  it('videoKey пуст → recordingFileUrl = null (подписание не вызывается)', async () => {
    db.meeting.findUnique.mockResolvedValue(meetingRow({ videoKey: null }));
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.recordingFileUrl).toBeNull();
    expect(mockGetFileUrl).not.toHaveBeenCalled();
  });

  it('запись отдаётся и студенту-участнику (recordingFileUrl присутствует)', async () => {
    db.meeting.findUnique.mockResolvedValue(meetingRow({ videoKey: 'meetings/m-1/rec.mp4' }));
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1',
      headers: authHeaders(studentAToken),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.recordingFileUrl).toBe('https://files.example/url');
    // Изоляция сохранена: студенту по-прежнему не отдаём recordingError/транскрипт.
    expect(m).not.toHaveProperty('recordingError');
    expect(m).not.toHaveProperty('transcriptStatus');
  });
});

describe('PATCH /meetings/:id/cancel — отмена (admin, своей)', () => {
  it('переводит в cancelled и best-effort удаляет Zoom-встречу', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: TEACHER_ID,
      status: 'planned',
      zoomMeetingId: '999',
    });
    db.meeting.update.mockResolvedValue(meetingRow({ status: 'cancelled' }));

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/cancel',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect(db.meeting.update.mock.calls[0][0].data).toEqual({ status: 'cancelled' });
    expect(mockDeleteZoom).toHaveBeenCalledWith(TEACHER_ID, '999');
  });

  it('чужую встречу (другой teacher) отменить нельзя → 404', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: 'teacher-2',
      status: 'planned',
      zoomMeetingId: null,
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/cancel',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(db.meeting.update).not.toHaveBeenCalled();
  });

  it('студент не может отменять (403)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/cancel',
      headers: authHeaders(studentAToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /meetings/:id/transcript — только админ-преподаватель встречи', () => {
  it('студент не имеет доступа (403 — роут admin-only)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1/transcript',
      headers: authHeaders(studentAToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('чужой админ (не teacher) → 404', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: 'teacher-2',
      transcriptStatus: 'ready',
      transcriptVttKey: 'k.vtt',
      transcriptTxtKey: 'k.txt',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1/transcript',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('teacher встречи получает подписанный URL', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: TEACHER_ID,
      transcriptStatus: 'ready',
      transcriptVttKey: 'k.vtt',
      transcriptTxtKey: 'k.txt',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/m-1/transcript?format=txt',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('https://files.example/url');
  });
});

describe('PATCH /meetings/:id/status — смена статуса (admin, своей)', () => {
  it('planned → done: меняет статус и возвращает { meeting }', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: TEACHER_ID,
      status: 'planned',
    });
    db.meeting.update.mockResolvedValue(meetingRow({ status: 'done' }));

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/status',
      headers: authHeaders(adminToken),
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meeting.status).toBe('done');
    expect(db.meeting.update.mock.calls[0][0].data).toEqual({ status: 'done' });
  });

  it('недопустимый статус → 400, БД не трогаем', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/status',
      headers: authHeaders(adminToken),
      payload: { status: 'wat' },
    });
    expect(res.statusCode).toBe(400);
    expect(db.meeting.findUnique).not.toHaveBeenCalled();
    expect(db.meeting.update).not.toHaveBeenCalled();
  });

  it('недопустимый переход (done → live) → 409, без update', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: TEACHER_ID,
      status: 'done',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/status',
      headers: authHeaders(adminToken),
      payload: { status: 'live' },
    });
    expect(res.statusCode).toBe(409);
    expect(db.meeting.update).not.toHaveBeenCalled();
  });

  it('чужая встреча (другой teacher) → 404, без update', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: 'teacher-2',
      status: 'planned',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/status',
      headers: authHeaders(adminToken),
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(404);
    expect(db.meeting.update).not.toHaveBeenCalled();
  });

  it('студент не может менять статус (403)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/meetings/m-1/status',
      headers: authHeaders(studentAToken),
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /meetings/:id/refresh — ручная подтяжка из Zoom (admin, своей)', () => {
  it('дёргает запись/итоги/транскрипт (kind=meeting) и возвращает { meeting }', async () => {
    db.meeting.findUnique
      .mockResolvedValueOnce({
        id: 'm-1',
        teacherId: TEACHER_ID,
        zoomMeetingId: '12345',
        zoomMeetingUuid: 'uuid-1',
      })
      .mockResolvedValueOnce(meetingRow({ zoomMeetingId: '12345', recordingStatus: 'ready' }));

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/refresh',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meeting.id).toBe('m-1');
    expect(mockProcessRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'm-1', meetingId: '12345', kind: 'meeting' }),
    );
    expect(mockProcessSummary).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'm-1', meetingId: '12345', kind: 'meeting' }),
    );
    expect(mockProcessTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'm-1', meetingId: '12345', kind: 'meeting' }),
    );
  });

  it('без zoomMeetingId → 400 «Zoom-встреча не создана», обработчики не зовём', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: TEACHER_ID,
      zoomMeetingId: null,
      zoomMeetingUuid: null,
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/refresh',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Zoom-встреча не создана');
    expect(mockProcessRecording).not.toHaveBeenCalled();
  });

  it('один сбойный шаг не валит остальные — всё равно 200 { meeting }', async () => {
    mockProcessSummary.mockRejectedValueOnce(new Error('Zoom 403'));
    db.meeting.findUnique
      .mockResolvedValueOnce({
        id: 'm-1',
        teacherId: TEACHER_ID,
        zoomMeetingId: '12345',
        zoomMeetingUuid: null,
      })
      .mockResolvedValueOnce(meetingRow({ zoomMeetingId: '12345' }));
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/refresh',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meeting.id).toBe('m-1');
  });

  it('чужая встреча → 404, обработчики не зовём', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: 'teacher-2',
      zoomMeetingId: '12345',
      zoomMeetingUuid: null,
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/refresh',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(mockProcessRecording).not.toHaveBeenCalled();
  });

  it('студент не может (403)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/refresh',
      headers: authHeaders(studentAToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /meetings/:id/recording/retry — повтор забора записи (admin, своей)', () => {
  it('запускает повтор (kind=meeting) и возвращает { meeting }', async () => {
    db.meeting.findUnique
      .mockResolvedValueOnce({ id: 'm-1', teacherId: TEACHER_ID, zoomMeetingId: '12345' })
      .mockResolvedValueOnce(meetingRow({ zoomMeetingId: '12345', recordingStatus: 'processing' }));

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/recording/retry',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meeting.id).toBe('m-1');
    expect(mockProcessRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'm-1',
        meetingId: '12345',
        teacherUserId: TEACHER_ID,
        kind: 'meeting',
      }),
    );
  });

  it('без zoomMeetingId → 400, повтор не запускаем', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: TEACHER_ID,
      zoomMeetingId: null,
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/recording/retry',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(mockProcessRecording).not.toHaveBeenCalled();
  });

  it('чужая встреча → 404, повтор не запускаем', async () => {
    db.meeting.findUnique.mockResolvedValue({
      id: 'm-1',
      teacherId: 'teacher-2',
      zoomMeetingId: '12345',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/recording/retry',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(mockProcessRecording).not.toHaveBeenCalled();
  });

  it('студент не может (403)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/m-1/recording/retry',
      headers: authHeaders(studentAToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
