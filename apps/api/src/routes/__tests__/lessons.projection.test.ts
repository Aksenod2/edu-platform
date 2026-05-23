import { describe, it, expect, vi } from 'vitest';

// projectLesson живёт в lessons.ts, который тянет prisma/s3/zoom/notifications на
// верхнем уровне. Для unit-теста ЧИСТОЙ проекции мокаем их — нам нужна только
// синхронная функция projectLesson (без БД/сети/S3).
vi.mock('@platform/db', () => ({ prisma: {}, Prisma: {} }));
vi.mock('../../middleware/auth.js', () => ({
  requireRole: () => () => {},
  authenticate: () => {},
}));
vi.mock('../../lib/notifications.js', () => ({ notifyMany: vi.fn() }));
vi.mock('../../lib/enrollment.js', () => ({ isEnrolled: vi.fn() }));
vi.mock('../../lib/s3.js', () => ({ uploadFile: vi.fn(), getFileUrl: vi.fn() }));
vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(),
  canCreateMeeting: vi.fn(),
}));

import { projectLesson } from '../lessons.js';

// Минимальный блок урока (поля, не относящиеся к тесту, заполнены пустышками).
function block() {
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
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    teachers: [],
  };
}

// Session с проваленной автозагрузкой записи Zoom (есть recordingError).
function failedSession() {
  return {
    status: 'planned' as const,
    date: null,
    startTime: null,
    meetingUrl: null,
    videoUrl: null,
    videoKey: null,
    summary: null,
    summarySource: null,
    recordingStatus: 'failed',
    recordingError: 'Не удалось скачать запись Zoom (HTTP 401)',
  };
}

describe('projectLesson — recordingError только админам (M4)', () => {
  it('admin: recordingError отдаётся как есть, recordingStatus тоже', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = projectLesson(block() as any, 'stream-1', failedSession() as any, true);
    expect(p.recordingStatus).toBe('failed');
    expect(p.recordingError).toBe('Не удалось скачать запись Zoom (HTTP 401)');
  });

  it('не-админ (студент): recordingError → null, recordingStatus сохраняется', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = projectLesson(block() as any, 'stream-1', failedSession() as any, false);
    expect(p.recordingStatus).toBe('failed'); // статус не чувствителен — оставляем
    expect(p.recordingError).toBeNull(); // деталь ошибки скрыта от студента
  });

  it('по умолчанию (admin-only роуты, без флага) recordingError виден', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = projectLesson(block() as any, 'stream-1', failedSession() as any);
    expect(p.recordingError).toBe('Не удалось скачать запись Zoom (HTTP 401)');
  });

  it('нет Session → recordingStatus/recordingError = null для любой роли', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pAdmin = projectLesson(block() as any, null, null, true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pStudent = projectLesson(block() as any, null, null, false);
    expect(pAdmin.recordingStatus).toBeNull();
    expect(pAdmin.recordingError).toBeNull();
    expect(pStudent.recordingStatus).toBeNull();
    expect(pStudent.recordingError).toBeNull();
  });
});
