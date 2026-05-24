import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Мокаем prisma: только методы, которые трогает PATCH /lessons/:id в сценариях
// смены статуса (отмена с Zoom, откат done→planned). DB-free.
vi.mock('@platform/db', () => ({
  prisma: {
    lesson: { findUnique: vi.fn(), update: vi.fn() },
    session: { findUnique: vi.fn(), upsert: vi.fn() },
    streamEnrollment: { findMany: vi.fn(() => Promise.resolve([])) },
    lessonVideo: { findMany: vi.fn(() => Promise.resolve([])) },
  },
  Prisma: {},
}));

// Уведомления — шпионим (проверяем отправку об отмене).
vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

// S3 — no-op.
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('signed-url')),
}));

// Zoom: deleteZoomMeeting шпионим (отмена должна удалять встречу).
// maybeCreateMeetingUrl уйдёт в no-op: shouldAutoCreate=false, generateMeeting не задан.
vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(() => Promise.resolve(false)),
  canCreateMeeting: vi.fn(() => Promise.resolve(false)),
  deleteZoomMeeting: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/zoom-recording.js', () => ({
  processRecordingForSession: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/zoom-attendance.js', () => ({
  pullSessionAttendanceFromZoom: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { lessonRoutes } from '../lessons.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import { notifyMany } from '../../lib/notifications.js';
import { deleteZoomMeeting } from '../../lib/zoom.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockNotifyMany = vi.mocked(notifyMany);
const mockDeleteMeeting = vi.mocked(deleteZoomMeeting);

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(lessonRoutes);
  return app;
}

// Блок урока в форме, которую возвращает findUnique(include: teacherInclude).
function lessonBlock() {
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
    teachers: [],
    videos: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.lesson.findUnique.mockResolvedValue(lessonBlock());
  db.lesson.update.mockResolvedValue(lessonBlock());
  db.lessonVideo.findMany.mockResolvedValue([]);
  db.streamEnrollment.findMany.mockResolvedValue([{ userId: 'stu-1' }, { userId: 'stu-2' }]);
});

describe('PATCH /lessons/:id — отмена занятия с Zoom', () => {
  it('переход planned→cancelled с zoomMeetingId: удаляет встречу Zoom + уведомляет студентов', async () => {
    // Текущая Session — planned (existingSession через sessionSelect, без zoomMeetingId).
    db.session.findUnique
      .mockResolvedValueOnce({
        status: 'planned',
        date: new Date('2026-05-20'),
        startTime: '10:00',
        meetingUrl: 'https://zoom/j/123',
        videoUrl: null,
        videoKey: null,
        summary: null,
        summarySource: null,
        recordingStatus: null,
        recordingError: null,
      })
      // Второй findUnique — точечный запрос zoomMeetingId в блоке отмены.
      .mockResolvedValueOnce({ zoomMeetingId: '12345' });

    db.session.upsert.mockResolvedValue({
      status: 'cancelled',
      date: new Date('2026-05-20'),
      startTime: '10:00',
      meetingUrl: 'https://zoom/j/123',
      videoUrl: null,
      videoKey: null,
      summary: null,
      summarySource: null,
      recordingStatus: null,
      recordingError: null,
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/lessons/lesson-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { streamId: 'stream-1', status: 'cancelled' },
    });

    expect(res.statusCode).toBe(200);
    // Дожидаемся fire-and-forget уведомления.
    await new Promise((r) => setImmediate(r));

    // Встреча Zoom удалена под токеном админа, делающего PATCH.
    expect(mockDeleteMeeting).toHaveBeenCalledTimes(1);
    expect(mockDeleteMeeting).toHaveBeenCalledWith('admin-1', '12345');

    // Студенты потока уведомлены об отмене (тот же канал notifyMany).
    const cancelCall = mockNotifyMany.mock.calls.find((c) => c[2] === 'Занятие отменено');
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.[0]).toEqual(['stu-1', 'stu-2']);
  });

  it('отмена БЕЗ zoomMeetingId: встречу не удаляет, но студентов уведомляет', async () => {
    db.session.findUnique
      .mockResolvedValueOnce({
        status: 'planned',
        date: new Date('2026-05-20'),
        startTime: null,
        meetingUrl: null,
        videoUrl: null,
        videoKey: null,
        summary: null,
        summarySource: null,
        recordingStatus: null,
        recordingError: null,
      })
      .mockResolvedValueOnce({ zoomMeetingId: null });

    db.session.upsert.mockResolvedValue({
      status: 'cancelled',
      date: new Date('2026-05-20'),
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
      method: 'PATCH',
      url: '/lessons/lesson-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { streamId: 'stream-1', status: 'cancelled' },
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(mockDeleteMeeting).not.toHaveBeenCalled();
    const cancelCall = mockNotifyMany.mock.calls.find((c) => c[2] === 'Занятие отменено');
    expect(cancelCall).toBeDefined();
  });

  it('уже cancelled → cancelled: НЕ дублирует уведомление и не трогает Zoom', async () => {
    db.session.findUnique.mockResolvedValueOnce({
      status: 'cancelled',
      date: new Date('2026-05-20'),
      startTime: null,
      meetingUrl: null,
      videoUrl: null,
      videoKey: null,
      summary: null,
      summarySource: null,
      recordingStatus: null,
      recordingError: null,
    });
    db.session.upsert.mockResolvedValue({
      status: 'cancelled',
      date: new Date('2026-05-20'),
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
      method: 'PATCH',
      url: '/lessons/lesson-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { streamId: 'stream-1', status: 'cancelled' },
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(mockDeleteMeeting).not.toHaveBeenCalled();
    const cancelCall = mockNotifyMany.mock.calls.find((c) => c[2] === 'Занятие отменено');
    expect(cancelCall).toBeUndefined();
  });
});

describe('PATCH /lessons/:id — откаты статуса разрешены', () => {
  it('откат done→planned (с датой) проходит: status сохраняется в Session', async () => {
    db.session.findUnique.mockResolvedValueOnce({
      status: 'done',
      date: new Date('2026-05-20'),
      startTime: '10:00',
      meetingUrl: null,
      videoUrl: null,
      videoKey: null,
      summary: null,
      summarySource: null,
      recordingStatus: null,
      recordingError: null,
    });
    db.session.upsert.mockResolvedValue({
      status: 'planned',
      date: new Date('2026-05-20'),
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
      method: 'PATCH',
      url: '/lessons/lesson-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { streamId: 'stream-1', status: 'planned' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lesson.status).toBe('planned');
    // upsert.update получил status='planned' (строгой валидации переходов нет).
    expect(db.session.upsert).toHaveBeenCalledTimes(1);
    expect(db.session.upsert.mock.calls[0][0].update.status).toBe('planned');
    // Откат — не отмена: Zoom не трогаем, уведомление об отмене не шлём.
    expect(mockDeleteMeeting).not.toHaveBeenCalled();
    const cancelCall = mockNotifyMany.mock.calls.find((c) => c[2] === 'Занятие отменено');
    expect(cancelCall).toBeUndefined();
  });

  it('откат planned→planned без даты → 400 (правило «planned требует даты» сохранено)', async () => {
    db.session.findUnique.mockResolvedValueOnce({
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
      method: 'PATCH',
      url: '/lessons/lesson-1',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { streamId: 'stream-1', status: 'planned' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('дата');
  });
});
