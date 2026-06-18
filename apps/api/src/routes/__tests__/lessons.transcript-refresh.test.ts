import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Тесты роутов «Обновить из Zoom» (POST .../refresh) и отдачи транскрипта
// (GET .../transcript). Проверяем КОНТРАКТ и ГЕЙТИНГ ДОСТУПА, а не саму выгрузку
// (lib zoom-recording замокана — её покрывают unit-тесты). DB-free: мокаем prisma.
vi.mock('@platform/db', () => ({
  prisma: {
    lesson: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    session: { findFirst: vi.fn() },
    lessonTeacher: { findMany: vi.fn(() => Promise.resolve([])), findFirst: vi.fn() },
  },
  Prisma: {},
}));

vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/enrollment.js', () => ({ isEnrolled: vi.fn(() => Promise.resolve(false)) }));

// getFileUrl возвращает подписанный URL — refresh/transcript отдают именно его.
vi.mock('../../lib/s3.js', () => ({
  uploadFile: vi.fn(() => Promise.resolve({ key: 'k', url: 'u', size: 1 })),
  getFileUrl: vi.fn(() => Promise.resolve('https://signed/transcript')),
}));

vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(() => Promise.resolve(false)),
  canCreateMeeting: vi.fn(() => Promise.resolve(true)),
  deleteZoomMeeting: vi.fn(),
}));

// Тяжёлую обработку Zoom мокаем — проверяем, что refresh её ВЫЗЫВАЕТ и собирает
// частичный результат. processSummary/Transcript управляем по тестам (успех/ошибка).
vi.mock('../../lib/zoom-recording.js', () => ({
  processRecordingForSession: vi.fn(() => Promise.resolve()),
  processSummaryForSession: vi.fn(() => Promise.resolve()),
  processTranscriptForSession: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/zoom-attendance.js', () => ({
  pullSessionAttendanceFromZoom: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { lessonRoutes } from '../lessons.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';
import {
  processRecordingForSession,
  processSummaryForSession,
  processTranscriptForSession,
} from '../../lib/zoom-recording.js';
import { pullSessionAttendanceFromZoom } from '../../lib/zoom-attendance.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockRecording = vi.mocked(processRecordingForSession);
const mockSummary = vi.mocked(processSummaryForSession);
const mockTranscript = vi.mocked(processTranscriptForSession);
const mockAttendance = vi.mocked(pullSessionAttendanceFromZoom);

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(lessonRoutes);
  return app;
}

const adminToken = signAccessToken({ userId: 'admin-1', role: 'admin' });
const teacherToken = signAccessToken({ userId: 'teacher-1', role: 'teacher' });
const studentToken = signAccessToken({ userId: 'stu-1', role: 'student' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  // По умолчанию преподавателей у урока нет (membership настраиваем в тестах).
  db.lessonTeacher.findMany.mockResolvedValue([]);
  db.lessonTeacher.findFirst.mockResolvedValue(null);
});

describe('POST /lessons/:id/sessions/:streamId/refresh — единая подтяжка из Zoom', () => {
  function sessionOk() {
    return {
      id: 'sess-1',
      streamId: 'str-1',
      zoomMeetingId: 'mtg-1',
      zoomMeetingUuid: '/abc==',
      lessonId: 'les-1',
    };
  }

  it('админ: все шаги ok → частичный результат со всеми ok:true', async () => {
    db.session.findFirst.mockResolvedValue(sessionOk());
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      recording: { ok: true },
      summary: { ok: true },
      transcript: { ok: true },
      attendance: { ok: true },
    });
    expect(mockRecording).toHaveBeenCalledTimes(1);
    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(mockTranscript).toHaveBeenCalledTimes(1);
    expect(mockAttendance).toHaveBeenCalledTimes(1);
    // UUID встречи из сессии прокидывается в подтяжку итогов (meeting_summary
    // не принимает числовой id — нужен UUID).
    expect(mockSummary).toHaveBeenCalledWith(
      expect.objectContaining({ meetingUuid: '/abc==' }),
    );
  });

  it('«ещё не готово» (processing) → reason «ещё формируется», а НЕ «не удалось»', async () => {
    db.session.findFirst.mockResolvedValue(sessionOk());
    // Запись/итоги/транскрипт у Zoom ещё формируются (данных нет) → 'processing'.
    mockRecording.mockResolvedValueOnce('processing' as never);
    mockSummary.mockResolvedValueOnce('processing' as never);
    mockTranscript.mockResolvedValueOnce('processing' as never);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Мягкий сигнал «формируется» (ok:false, но reason НЕ про ошибку).
    expect(body.recording).toEqual({ ok: false, reason: 'ещё формируется' });
    expect(body.summary).toEqual({ ok: false, reason: 'ещё формируется' });
    expect(body.transcript).toEqual({ ok: false, reason: 'ещё формируется' });
    // Реальной ошибки нет — формулировка «не удалось …» не должна появляться.
    expect(body.recording.reason).not.toContain('не удалось');
  });

  it('частичный результат: ошибка одного шага НЕ валит остальные', async () => {
    db.session.findFirst.mockResolvedValue(sessionOk());
    mockTranscript.mockRejectedValueOnce(new Error('boom'));
    mockAttendance.mockResolvedValueOnce({ ok: false, reason: 'отчёт ещё не готов' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recording).toEqual({ ok: true });
    expect(body.summary).toEqual({ ok: true });
    expect(body.transcript.ok).toBe(false);
    // Итоги/транскрипт: при реальной ошибке reason несёт ФАКТИЧЕСКИЙ текст (диагностика).
    expect(body.transcript.reason).toBe('boom');
    // Посещаемость вернула мягкий отказ — пробрасываем её reason как есть.
    expect(body.attendance).toEqual({ ok: false, reason: 'отчёт ещё не готов' });
  });

  it('итоги/транскрипт: реальная ошибка Zoom (403) → reason несёт код статуса', async () => {
    db.session.findFirst.mockResolvedValue(sessionOk());
    // getMeetingSummary бросает Error с текстом, уже содержащим код статуса.
    mockSummary.mockRejectedValueOnce(
      new Error('Zoom вернул ошибку при получении резюме (403): scope missing'),
    );
    mockTranscript.mockRejectedValueOnce(
      new Error('Zoom вернул ошибку при получении записей (403)'),
    );
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.ok).toBe(false);
    expect(body.summary.reason).toContain('(403)');
    expect(body.summary.reason).toBe('Zoom вернул ошибку при получении резюме (403): scope missing');
    expect(body.transcript.ok).toBe(false);
    expect(body.transcript.reason).toContain('(403)');
  });

  it('итоги/транскрипт: ошибка без текста → фолбэк на общий reason', async () => {
    db.session.findFirst.mockResolvedValue(sessionOk());
    // Error с пустым message — exposeError даёт пустую строку → фолбэк failReason.
    mockSummary.mockRejectedValueOnce(new Error(''));
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toEqual({ ok: false, reason: 'не удалось обновить итоги' });
  });

  it('преподаватель урока (НЕ админ) тоже может обновлять (право — препод урока ИЛИ админ)', async () => {
    db.session.findFirst.mockResolvedValue(sessionOk());
    // teacher-1 числится преподавателем урока → гард пускает.
    db.lessonTeacher.findFirst.mockResolvedValue({ userId: 'teacher-1' });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(teacherToken),
    });

    expect(res.statusCode).toBe(200);
    expect(mockRecording).toHaveBeenCalledTimes(1);
  });

  it('студент → 403 (не админ и не преподаватель урока)', async () => {
    db.lessonTeacher.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(studentToken),
    });

    expect(res.statusCode).toBe(403);
    expect(mockRecording).not.toHaveBeenCalled();
  });

  it('нет привязки к встрече Zoom → 400', async () => {
    db.session.findFirst.mockResolvedValue({
      id: 'sess-1',
      streamId: 'str-1',
      zoomMeetingId: null,
      lessonId: 'les-1',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('занятие не найдено → 404', async () => {
    db.session.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/les-1/sessions/str-1/refresh',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /lessons/:id/sessions/:streamId/transcript — отдача тела транскрипта', () => {
  it('админ, format=txt → подписанный URL на .txt', async () => {
    db.session.findFirst.mockResolvedValue({
      id: 'sess-1',
      transcriptStatus: 'ready',
      transcriptVttKey: 'transcript/sess-1.vtt',
      transcriptTxtKey: 'transcript/sess-1.txt',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/les-1/sessions/str-1/transcript?format=txt',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe('txt');
    expect(body.url).toBe('https://signed/transcript');
    expect(body.status).toBe('ready');
  });

  it('преподаватель урока, format=vtt → доступ есть', async () => {
    db.lessonTeacher.findFirst.mockResolvedValue({ userId: 'teacher-1' });
    db.session.findFirst.mockResolvedValue({
      id: 'sess-1',
      transcriptStatus: 'ready',
      transcriptVttKey: 'transcript/sess-1.vtt',
      transcriptTxtKey: 'transcript/sess-1.txt',
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/les-1/sessions/str-1/transcript?format=vtt',
      headers: authHeaders(teacherToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().format).toBe('vtt');
  });

  it('студент → 403 (транскрипт студенту недоступен)', async () => {
    db.lessonTeacher.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/les-1/sessions/str-1/transcript',
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
    // До чтения сессии/ключей дело не дошло (гард отбил раньше).
    expect(db.session.findFirst).not.toHaveBeenCalled();
  });

  it('нет ключа транскрипта → 404 со статусом', async () => {
    db.session.findFirst.mockResolvedValue({
      id: 'sess-1',
      transcriptStatus: 'pending',
      transcriptVttKey: null,
      transcriptTxtKey: null,
    });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/les-1/sessions/str-1/transcript',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().status).toBe('pending');
  });

  it('без авторизации → 401', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/lessons/les-1/sessions/str-1/transcript',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /lessons/:id/materials?s3Key= — удаление материала (ключ в query)', () => {
  const materials = [
    { s3Key: 'lesson-materials/1-a.md', fileName: 'a.md', mimeType: 'text/markdown', size: 1 },
    { s3Key: 'lesson-materials/2-b.pdf', fileName: 'b.pdf', mimeType: 'application/pdf', size: 2 },
  ];

  it('админ: удаляет материал по s3Key (со слэшем) из query → остаётся остальное', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'les-1', materials });
    db.lesson.update.mockResolvedValue({ id: 'les-1' });
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/lessons/les-1/materials?s3Key=${encodeURIComponent('lesson-materials/1-a.md')}`,
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    // В update ушёл список без удалённого ключа. sanitizeLessonMaterials аддитивно
    // нормализует материалы признаком видимости streamId (null = общий материал-метод),
    // поэтому сверяем по содержимому оставшегося ключа.
    expect(db.lesson.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'les-1' },
        data: {
          materials: [expect.objectContaining({ s3Key: 'lesson-materials/2-b.pdf', streamId: null })],
        },
      }),
    );
    expect(res.json().materials).toEqual([
      expect.objectContaining({ s3Key: 'lesson-materials/2-b.pdf' }),
    ]);
  });

  it('без s3Key в query → 400, ничего не удаляем', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/lessons/les-1/materials',
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(db.lesson.update).not.toHaveBeenCalled();
  });

  it('не админ (студент) → 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/lessons/les-1/materials?s3Key=${encodeURIComponent('lesson-materials/1-a.md')}`,
      headers: authHeaders(studentToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
