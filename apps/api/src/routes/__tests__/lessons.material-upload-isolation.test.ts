import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Задача 3 эпика «Изоляция материалов урока по группам»: при ЗАГРУЗКЕ материала/видео
// админ выбирает видимость — общий (streamId не задан) или конкретный поток урока.
//   - валидный streamId (есть Session урока)        → сохраняется с этим потоком;
//   - невалидный (поток не ведёт урок)              → 400;
//   - без streamId                                  → общий (streamId=null);
//   - замена одноимённого общего и пер-потокового материала НЕ затирает друг друга.

vi.mock('@platform/db', () => {
  class FakeKnownRequestError extends Error {
    code: string;
    constructor(message: string, meta: { code: string; clientVersion: string }) {
      super(message);
      this.code = meta.code;
    }
  }
  return {
    prisma: {
      lesson: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      stream: { findUnique: vi.fn() },
      session: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
      streamEnrollment: { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn() },
      lessonVideo: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
      programLesson: { findMany: vi.fn() },
      lessonTeacher: { findMany: vi.fn(), findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
    Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError },
  };
});

vi.mock('../../lib/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
  notifyMany: vi.fn(() => Promise.resolve()),
}));

const uploadFileMock = vi.fn(() =>
  Promise.resolve({ key: 'lesson-materials/new.pdf', url: 'u', size: 123 }),
);
const uploadLargeFileMock = vi.fn(() =>
  Promise.resolve({ key: 'lesson-videos/new.mp4', url: 'u' }),
);
const deleteFileMock = vi.fn(() => Promise.resolve());
const verifyStoredObjectMock = vi.fn(() => Promise.resolve({ ok: true, detail: '' }));
vi.mock('../../lib/s3.js', () => ({
  uploadFile: (...a: unknown[]) => uploadFileMock(...(a as [])),
  uploadLargeFile: (...a: unknown[]) => uploadLargeFileMock(...(a as [])),
  deleteFile: (...a: unknown[]) => deleteFileMock(...(a as [])),
  getFileUrl: (key: string) => Promise.resolve(`signed:${key}`),
  verifyStoredObject: (...a: unknown[]) => verifyStoredObjectMock(...(a as [])),
  VIDEO_MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024,
}));

vi.mock('../../lib/zoom.js', () => ({
  createZoomMeeting: vi.fn(),
  shouldAutoCreate: vi.fn(() => Promise.resolve(false)),
  canCreateMeeting: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('../../lib/zoom-recording.js', () => ({
  processRecordingForSession: vi.fn(() => Promise.resolve()),
}));

import { lessonRoutes } from '../lessons.js';
import { prisma } from '@platform/db';
import { signAccessToken } from '../../lib/jwt.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(lessonRoutes);
  await app.ready();
  return app;
}

const adminToken = signAccessToken({ userId: 'adm-1', role: 'admin' });

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Собирает multipart/form-data вручную (без зависимости form-data): один файл.
function buildMultipart(fileName: string, contentType: string, content = 'data') {
  const boundary = '----vitestBoundary' + Math.random().toString(16).slice(2);
  const CRLF = '\r\n';
  const parts: Buffer[] = [];
  parts.push(
    Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
        `Content-Type: ${contentType}${CRLF}${CRLF}`,
    ),
  );
  parts.push(Buffer.from(content));
  parts.push(Buffer.from(CRLF));
  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

// Хелпер: multipart-загрузка одного файла → inject.
async function uploadMultipart(
  app: FastifyInstance,
  url: string,
  fileName: string,
  contentType: string,
  content = 'data',
) {
  const mp = buildMultipart(fileName, contentType, content);
  return app.inject({
    method: 'POST',
    url,
    headers: { ...authHeaders(adminToken), ...mp.headers },
    payload: mp.payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadFileMock.mockResolvedValue({ key: 'lesson-materials/new.pdf', url: 'u', size: 123 });
  uploadLargeFileMock.mockResolvedValue({ key: 'lesson-videos/new.mp4', url: 'u' });
  verifyStoredObjectMock.mockResolvedValue({ ok: true, detail: '' });
});

describe('POST /lessons/:id/materials — выбор видимости при загрузке', () => {
  it('валидный streamId (есть Session урока) → материал сохраняется с этим потоком', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1', materials: [] });
    db.session.findUnique.mockResolvedValue({ streamId: 'stream-A' }); // поток ведёт урок
    db.lesson.update.mockResolvedValue({});

    const app = await buildApp();
    const res = await uploadMultipart(
      app,
      '/lessons/l1/materials?streamId=stream-A',
      'm.pdf',
      'application/pdf',
    );

    expect(res.statusCode).toBe(201);
    // Записан материал с streamId потока A.
    const written = db.lesson.update.mock.calls[0][0].data.materials;
    expect(written).toHaveLength(1);
    expect(written[0].streamId).toBe('stream-A');
    // Валидация шла против сессий урока (streamId_lessonId).
    expect(db.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { streamId_lessonId: { streamId: 'stream-A', lessonId: 'l1' } },
      }),
    );
  });

  it('невалидный streamId (поток не ведёт урок) → 400, материал не пишется', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1', materials: [] });
    db.session.findUnique.mockResolvedValue(null); // нет такой сессии

    const app = await buildApp();
    const res = await uploadMultipart(
      app,
      '/lessons/l1/materials?streamId=stream-X',
      'm.pdf',
      'application/pdf',
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('не ведёт этот урок');
    expect(db.lesson.update).not.toHaveBeenCalled();
  });

  it('без streamId → общий материал (streamId=null), валидации сессий нет', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1', materials: [] });
    db.lesson.update.mockResolvedValue({});

    const app = await buildApp();
    const res = await uploadMultipart(app, '/lessons/l1/materials', 'm.pdf', 'application/pdf');

    expect(res.statusCode).toBe(201);
    const written = db.lesson.update.mock.calls[0][0].data.materials;
    expect(written[0].streamId).toBeNull();
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });

  it('замена одноимённого: общий и пер-потоковый материал НЕ затирают друг друга', async () => {
    // В уроке уже есть общий «m.pdf» и пер-потоковый «m.pdf» (поток A).
    db.lesson.findUnique.mockResolvedValue({
      id: 'l1',
      materials: [
        { s3Key: 'old-common', fileName: 'm.pdf', mimeType: 'application/pdf', size: 1, streamId: null },
        { s3Key: 'old-A', fileName: 'm.pdf', mimeType: 'application/pdf', size: 1, streamId: 'stream-A' },
      ],
    });
    db.lesson.update.mockResolvedValue({});
    uploadFileMock.mockResolvedValue({ key: 'new-common', url: 'u', size: 9 });

    // Перезаливаем ОБЩИЙ «m.pdf» (без streamId) — пер-потоковый остаётся нетронутым.
    const app = await buildApp();
    const res = await uploadMultipart(app, '/lessons/l1/materials', 'm.pdf', 'application/pdf');

    expect(res.statusCode).toBe(201);
    const written = db.lesson.update.mock.calls[0][0].data.materials;
    // Пер-потоковый m.pdf потока A сохранён; общий заменён на новый ключ.
    const byStream = (sid: string | null) =>
      written.filter((m: { streamId: string | null }) => (m.streamId ?? null) === sid);
    expect(byStream('stream-A')).toHaveLength(1);
    expect(byStream('stream-A')[0].s3Key).toBe('old-A'); // не затёрт
    expect(byStream(null)).toHaveLength(1);
    expect(byStream(null)[0].s3Key).toBe('new-common'); // заменён
    // Старый общий объект подчищен, пер-потоковый — нет.
    expect(deleteFileMock).toHaveBeenCalledWith('old-common');
    expect(deleteFileMock).not.toHaveBeenCalledWith('old-A');
  });
});

describe('POST /lessons/:id/videos — выбор видимости при загрузке (ссылка/файл)', () => {
  it('JSON-ссылка с валидным streamId → видео сохраняется с потоком', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1' });
    db.lessonVideo.findFirst.mockResolvedValue(null);
    db.session.findUnique.mockResolvedValue({ streamId: 'stream-A' });
    db.lessonVideo.create.mockResolvedValue({});
    db.lessonVideo.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/l1/videos',
      headers: { ...authHeaders(adminToken), 'content-type': 'application/json' },
      payload: { url: 'https://x/v', streamId: 'stream-A' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.lessonVideo.create.mock.calls[0][0].data.streamId).toBe('stream-A');
  });

  it('JSON-ссылка с невалидным streamId → 400', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1' });
    db.lessonVideo.findFirst.mockResolvedValue(null);
    db.session.findUnique.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/l1/videos',
      headers: { ...authHeaders(adminToken), 'content-type': 'application/json' },
      payload: { url: 'https://x/v', streamId: 'stream-X' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.lessonVideo.create).not.toHaveBeenCalled();
  });

  it('JSON-ссылка без streamId → общее видео (streamId=null)', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1' });
    db.lessonVideo.findFirst.mockResolvedValue(null);
    db.lessonVideo.create.mockResolvedValue({});
    db.lessonVideo.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lessons/l1/videos',
      headers: { ...authHeaders(adminToken), 'content-type': 'application/json' },
      payload: { url: 'https://x/v' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.lessonVideo.create.mock.calls[0][0].data.streamId).toBeNull();
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });

  it('multipart-файл с валидным streamId (?streamId=) → видео сохраняется с потоком', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1' });
    db.lessonVideo.findFirst.mockResolvedValue(null);
    db.session.findUnique.mockResolvedValue({ streamId: 'stream-A' });
    db.lessonVideo.create.mockResolvedValue({});
    db.lessonVideo.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await uploadMultipart(
      app,
      '/lessons/l1/videos?streamId=stream-A',
      'v.mp4',
      'video/mp4',
    );

    expect(res.statusCode).toBe(201);
    expect(db.lessonVideo.create.mock.calls[0][0].data.streamId).toBe('stream-A');
  });

  it('multipart-файл с невалидным streamId → 400 и удаление загруженного объекта', async () => {
    db.lesson.findUnique.mockResolvedValue({ id: 'l1' });
    db.lessonVideo.findFirst.mockResolvedValue(null);
    db.session.findUnique.mockResolvedValue(null);
    uploadLargeFileMock.mockResolvedValue({ key: 'lesson-videos/orphan.mp4', url: 'u' });

    const app = await buildApp();
    const res = await uploadMultipart(
      app,
      '/lessons/l1/videos?streamId=stream-X',
      'v.mp4',
      'video/mp4',
    );

    expect(res.statusCode).toBe(400);
    expect(db.lessonVideo.create).not.toHaveBeenCalled();
    // Загруженный объект подчищен, чтобы не оставить сироту.
    expect(deleteFileMock).toHaveBeenCalledWith('lesson-videos/orphan.mp4');
  });
});

describe('PATCH /lessons/:id/videos/:videoId — смена видимости', () => {
  it('сменить общий → поток (валидный streamId)', async () => {
    db.lessonVideo.findFirst.mockResolvedValue({ id: 'v1', lessonId: 'l1', videoKey: 'vk', videoUrl: null, streamId: null });
    db.session.findUnique.mockResolvedValue({ streamId: 'stream-A' });
    db.lessonVideo.update.mockResolvedValue({});
    db.lessonVideo.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/lessons/l1/videos/v1',
      headers: { ...authHeaders(adminToken), 'content-type': 'application/json' },
      payload: { streamId: 'stream-A' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.lessonVideo.update.mock.calls[0][0].data.streamId).toBe('stream-A');
  });

  it('сбросить поток → общий (streamId=null)', async () => {
    db.lessonVideo.findFirst.mockResolvedValue({ id: 'v1', lessonId: 'l1', videoKey: 'vk', videoUrl: null, streamId: 'stream-A' });
    db.lessonVideo.update.mockResolvedValue({});
    db.lessonVideo.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/lessons/l1/videos/v1',
      headers: { ...authHeaders(adminToken), 'content-type': 'application/json' },
      payload: { streamId: null },
    });

    expect(res.statusCode).toBe(200);
    expect(db.lessonVideo.update.mock.calls[0][0].data).toHaveProperty('streamId', null);
    expect(db.session.findUnique).not.toHaveBeenCalled();
  });

  it('невалидный streamId → 400', async () => {
    db.lessonVideo.findFirst.mockResolvedValue({ id: 'v1', lessonId: 'l1', videoKey: 'vk', videoUrl: null, streamId: null });
    db.session.findUnique.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/lessons/l1/videos/v1',
      headers: { ...authHeaders(adminToken), 'content-type': 'application/json' },
      payload: { streamId: 'stream-X' },
    });

    expect(res.statusCode).toBe(400);
    expect(db.lessonVideo.update).not.toHaveBeenCalled();
  });

  it('streamId не передан → видимость не трогаем (меняем только title)', async () => {
    db.lessonVideo.findFirst.mockResolvedValue({ id: 'v1', lessonId: 'l1', videoKey: 'vk', videoUrl: null, streamId: 'stream-A' });
    db.lessonVideo.update.mockResolvedValue({});
    db.lessonVideo.findMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/lessons/l1/videos/v1',
      headers: { ...authHeaders(adminToken), 'content-type': 'application/json' },
      payload: { title: 'Новое название' },
    });

    expect(res.statusCode).toBe(200);
    const data = db.lessonVideo.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('streamId');
    expect(data.title).toBe('Новое название');
  });
});
