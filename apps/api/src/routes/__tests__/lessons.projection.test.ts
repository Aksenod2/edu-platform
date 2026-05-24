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
    summaryStatus: 'failed',
    recordingStatus: 'failed',
    recordingError: 'Не удалось скачать запись Zoom (HTTP 401)',
    transcriptStatus: 'failed',
    transcriptError: 'Не удалось обработать транскрипт Zoom',
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

describe('projectLesson — гейтинг транскрипта (Ф1.4): студенту transcript* ИСКЛЮЧЕНЫ', () => {
  it('canSeeTranscript=true (препод/админ): поля transcriptStatus/transcriptError присутствуют', () => {
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      block() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      failedSession() as any,
      true, // isAdmin
      true, // canSeeTranscript
    );
    expect('transcriptStatus' in p).toBe(true);
    expect('transcriptError' in p).toBe(true);
    expect(p.transcriptStatus).toBe('failed');
    expect(p.transcriptError).toBe('Не удалось обработать транскрипт Zoom');
  });

  it('canSeeTranscript=false (студент): ключей transcriptStatus/transcriptError НЕТ в объекте (исключены, не занулены)', () => {
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      block() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      failedSession() as any,
      false, // isAdmin (студент)
      false, // canSeeTranscript
    );
    // КЛЮЧЕВОЕ требование безопасности: поля отсутствуют целиком.
    expect('transcriptStatus' in p).toBe(false);
    expect('transcriptError' in p).toBe(false);
    // Сырых ключей S3 транскрипта в проекции нет НИКОГДА (ни для кого).
    expect('transcriptVttKey' in p).toBe(false);
    expect('transcriptTxtKey' in p).toBe(false);
  });

  it('summaryStatus виден всем (это про готовность итогов, не про доступ к транскрипту)', () => {
    const pStudent = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      block() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      failedSession() as any,
      false,
      false,
    );
    expect(pStudent.summaryStatus).toBe('failed');
  });

  it('по умолчанию canSeeTranscript наследует isAdmin: admin-only роуты видят транскрипт', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = projectLesson(block() as any, 'stream-1', failedSession() as any);
    expect('transcriptStatus' in p).toBe(true);
  });
});

describe('projectLesson — развод учебного видео и записи Zoom-занятия', () => {
  // Урок с учебным видео (грузится ДО урока): block.videoKey/videoUrl/videos[].
  function blockWithVideo() {
    return {
      ...block(),
      videoKey: 'lesson/learning-video.mp4',
      videoUrl: 'https://cdn.example/learning-video.mp4',
      videos: [{ id: 'v1', videoKey: 'lesson/learning-video.mp4', sortOrder: 0 }],
    };
  }

  // Session с записью проведённого занятия (подтягивается ПОСЛЕ урока).
  function sessionWithRecording() {
    return {
      status: 'completed' as const,
      date: null,
      startTime: null,
      meetingUrl: null,
      videoKey: 'session/zoom-recording.mp4',
      videoUrl: 'https://cdn.example/zoom-recording.mp4',
      summary: null,
      summarySource: null,
      recordingStatus: 'ready',
      recordingError: null,
    };
  }

  it('запись Zoom НЕ перетирает учебное видео: учебное из block, запись в recording*', () => {
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blockWithVideo() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionWithRecording() as any,
      true,
    );
    // Учебное видео — строго из блока, не перетёрто записью занятия.
    expect(p.videoKey).toBe('lesson/learning-video.mp4');
    expect(p.videoUrl).toBe('https://cdn.example/learning-video.mp4');
    // Запись занятия — в отдельных полях, равна Session.videoKey/videoUrl.
    expect(p.recordingVideoKey).toBe('session/zoom-recording.mp4');
    expect(p.recordingVideoUrl).toBe('https://cdn.example/zoom-recording.mp4');
  });

  it('есть запись, но у урока нет учебного видео → учебные поля null, запись из Session', () => {
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      block() as any, // без учебного видео (videoKey/videoUrl = null)
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessionWithRecording() as any,
      true,
    );
    expect(p.videoKey).toBeNull();
    expect(p.videoUrl).toBeNull();
    expect(p.recordingVideoKey).toBe('session/zoom-recording.mp4');
    expect(p.recordingVideoUrl).toBe('https://cdn.example/zoom-recording.mp4');
  });

  it('есть учебное видео, но записи нет (нет Session) → recording* = null, учебное сохранено', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = projectLesson(blockWithVideo() as any, null, null, true);
    expect(p.videoKey).toBe('lesson/learning-video.mp4');
    expect(p.videoUrl).toBe('https://cdn.example/learning-video.mp4');
    expect(p.recordingVideoKey).toBeNull();
    expect(p.recordingVideoUrl).toBeNull();
  });

  it('есть Session без записи (videoKey=null) → recording* = null, учебное из block', () => {
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blockWithVideo() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      failedSession() as any, // videoKey/videoUrl = null
      true,
    );
    expect(p.videoKey).toBe('lesson/learning-video.mp4');
    expect(p.videoUrl).toBe('https://cdn.example/learning-video.mp4');
    expect(p.recordingVideoKey).toBeNull();
    expect(p.recordingVideoUrl).toBeNull();
  });
});
