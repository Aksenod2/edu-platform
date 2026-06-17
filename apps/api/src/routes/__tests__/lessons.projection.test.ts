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
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(),
  // Подписываем как `signed:<key>` — так в тестах видно, какие ключи подписывались.
  getFileUrl: vi.fn((key: string) => Promise.resolve(`signed:${key}`)),
}));
vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(),
  canCreateMeeting: vi.fn(),
}));

import {
  projectLesson,
  sanitizeLessonMaterials,
  regenerateLessonMaterialUrls,
} from '../lessons.js';
import { getFileUrl } from '../../lib/s3.js';

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
    recordingRequestedAt: null,
    summaryRequestedAt: null,
    transcriptStatus: 'failed',
    transcriptError: 'Не удалось обработать транскрипт Zoom',
    transcriptRequestedAt: null,
  };
}

// Session «формируется»: данные ещё готовятся, отметки времени проставлены.
function formingSession() {
  return {
    status: 'done' as const,
    date: null,
    startTime: null,
    meetingUrl: null,
    videoUrl: null,
    videoKey: null,
    summary: null,
    summarySource: null,
    summaryStatus: 'pending',
    recordingStatus: 'processing',
    recordingError: null,
    recordingRequestedAt: new Date('2026-05-24T10:00:00.000Z'),
    summaryRequestedAt: new Date('2026-05-24T10:00:00.000Z'),
    transcriptStatus: 'pending',
    transcriptError: null,
    transcriptRequestedAt: new Date('2026-05-24T10:05:00.000Z'),
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

describe('projectLesson — отметки времени *RequestedAt («формируется» vs «таймаут»)', () => {
  it('recordingRequestedAt/summaryRequestedAt отдаются всем (ISO-строкой)', () => {
    // Студент (isAdmin=false, canSeeTranscript=false) тоже видит record/summary-отметки.
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      block() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formingSession() as any,
      false,
      false,
    );
    expect(p.recordingRequestedAt).toBe('2026-05-24T10:00:00.000Z');
    expect(p.summaryRequestedAt).toBe('2026-05-24T10:00:00.000Z');
  });

  it('transcriptRequestedAt виден преподу/админу (canSeeTranscript=true)', () => {
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      block() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formingSession() as any,
      true,
      true,
    );
    expect('transcriptRequestedAt' in p).toBe(true);
    expect(p.transcriptRequestedAt).toBe('2026-05-24T10:05:00.000Z');
  });

  it('transcriptRequestedAt ИСКЛЮЧЁН для студента (гейт как у остальных transcript*)', () => {
    const p = projectLesson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      block() as any,
      'stream-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formingSession() as any,
      false,
      false,
    );
    expect('transcriptRequestedAt' in p).toBe(false);
  });

  it('нет Session → *RequestedAt = null (record/summary), transcript-отметка отсутствует у студента', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pAdmin = projectLesson(block() as any, null, null, true, true);
    expect(pAdmin.recordingRequestedAt).toBeNull();
    expect(pAdmin.summaryRequestedAt).toBeNull();
    expect(pAdmin.transcriptRequestedAt).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pStudent = projectLesson(block() as any, null, null, false, false);
    expect(pStudent.recordingRequestedAt).toBeNull();
    expect(pStudent.summaryRequestedAt).toBeNull();
    expect('transcriptRequestedAt' in pStudent).toBe(false);
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

describe('sanitizeLessonMaterials — признак видимости streamId (изоляция по группам)', () => {
  it('строковый streamId сохраняется; отсутствие/невалидный → null (общий материал-метод)', () => {
    const out = sanitizeLessonMaterials([
      { s3Key: 'a', fileName: 'a.pdf', streamId: 'stream-A' },
      { s3Key: 'b', fileName: 'b.pdf' }, // без поля → null
      { s3Key: 'c', fileName: 'c.pdf', streamId: null }, // явный null → null
      { s3Key: 'd', fileName: 'd.pdf', streamId: 123 }, // невалидный тип → null
    ]);
    expect(out.map((m) => [m.s3Key, m.streamId])).toEqual([
      ['a', 'stream-A'],
      ['b', null],
      ['c', null],
      ['d', null],
    ]);
  });
});

describe('regenerateLessonMaterialUrls — фильтрация материалов по контексту получателя', () => {
  const materials = [
    { s3Key: 'mat-common', fileName: 'общий.pdf', mimeType: 'application/pdf', size: 1, streamId: null },
    { s3Key: 'mat-A', fileName: 'A.pdf', mimeType: 'application/pdf', size: 1, streamId: 'stream-A' },
    { s3Key: 'mat-B', fileName: 'B.pdf', mimeType: 'application/pdf', size: 1, streamId: 'stream-B' },
    // legacy без поля — общий
    { s3Key: 'mat-legacy', fileName: 'старый.pdf', mimeType: 'application/pdf', size: 1 },
  ];

  it('студент потока A: только общие + поток A; чужой ключ потока B НЕ подписывается', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getFileUrl as any).mockClear();
    const out = await regenerateLessonMaterialUrls(materials, {
      viewerStreamId: 'stream-A',
      isAdmin: false,
    });
    const keys = out.map((m) => m.s3Key).sort();
    expect(keys).toEqual(['mat-A', 'mat-common', 'mat-legacy']);
    expect(keys).not.toContain('mat-B');
    // Чужой ключ не подписывался (фильтрация ДО подписи).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signed = (getFileUrl as any).mock.calls.map((c: unknown[]) => c[0]);
    expect(signed).not.toContain('mat-B');
    expect(signed).toContain('mat-A');
  });

  it('админ: видит все материалы (включая поток B), без сужения', async () => {
    const out = await regenerateLessonMaterialUrls(materials, {
      viewerStreamId: null,
      isAdmin: true,
    });
    expect(out.map((m) => m.s3Key).sort()).toEqual(['mat-A', 'mat-B', 'mat-common', 'mat-legacy']);
  });

  it('по умолчанию (без ctx) — админский режим: все материалы (мутации POST/PATCH не сужаются)', async () => {
    const out = await regenerateLessonMaterialUrls(materials);
    expect(out.length).toBe(4);
  });
});
