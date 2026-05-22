import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Admin Bearer fallback hits the DB for `sk_` keys — keep it mockable & DB-free.
vi.mock('@platform/db', () => ({
  prisma: {
    apiKey: { findUnique: vi.fn(), update: vi.fn(() => Promise.resolve({})) },
  },
}));

// Control authorization (signature) and file reads deterministically.
vi.mock('../../lib/s3.js', () => ({
  verifyFileSignature: vi.fn(),
  readFile: vi.fn(),
}));

import { fileRoutes } from '../files.js';
import { verifyFileSignature, readFile } from '../../lib/s3.js';
import { signAccessToken } from '../../lib/jwt.js';

const mockVerify = vi.mocked(verifyFileSignature);
const mockRead = vi.mocked(readFile);

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(fileRoutes);
  return app;
}

const okFull = {
  kind: 'ok' as const,
  body: Buffer.from('hello'),
  contentType: 'text/plain',
  fileName: 'h.txt',
  contentLength: 5,
  totalSize: 5,
  isPartial: false,
  start: 0,
  end: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockReturnValue(false);
});

describe('GET /files/* — авторизация', () => {
  it('без подписи и без авторизации → 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/files/threads/x.txt' });
    expect(res.statusCode).toBe(401);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('валидная подпись → 200 + содержимое', async () => {
    mockVerify.mockReturnValue(true);
    mockRead.mockResolvedValue(okFull);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/files/threads/x.txt?exp=9999999999&sig=abc' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('hello');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-length']).toBe('5');
  });

  it('подделанная подпись (verify=false) без иной авторизации → 401', async () => {
    mockVerify.mockReturnValue(false);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/files/threads/x.txt?exp=1&sig=bad' });
    expect(res.statusCode).toBe(401);
  });

  it('admin Bearer без подписи → 200 (fallback)', async () => {
    mockRead.mockResolvedValue(okFull);
    const token = signAccessToken({ userId: 'u-admin', role: 'admin' });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/files/threads/x.txt',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('student Bearer без подписи → 401', async () => {
    const token = signAccessToken({ userId: 'u-student', role: 'student' });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/files/threads/x.txt',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /files/* — отдача и Range', () => {
  it('?download=1 → Content-Disposition attachment', async () => {
    mockVerify.mockReturnValue(true);
    mockRead.mockResolvedValue(okFull);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/files/threads/x.txt?exp=9999999999&sig=abc&download=1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('частичный ответ (Range) → 206 + Content-Range', async () => {
    mockVerify.mockReturnValue(true);
    mockRead.mockResolvedValue({
      kind: 'ok',
      body: Buffer.from('ell'),
      contentType: 'video/mp4',
      fileName: 'v.mp4',
      contentLength: 3,
      totalSize: 5,
      isPartial: true,
      start: 1,
      end: 3,
    });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/files/lessons/v.mp4?exp=9999999999&sig=abc',
      headers: { range: 'bytes=1-3' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 1-3/5');
    expect(res.headers['content-length']).toBe('3');
    expect(res.body).toBe('ell');
  });

  it('файл не найден → 404', async () => {
    mockVerify.mockReturnValue(true);
    mockRead.mockResolvedValue({ kind: 'not_found' });

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/files/threads/missing?exp=9999999999&sig=abc' });
    expect(res.statusCode).toBe(404);
  });

  it('недопустимый диапазон → 416 + Content-Range */total', async () => {
    mockVerify.mockReturnValue(true);
    mockRead.mockResolvedValue({ kind: 'range_not_satisfiable', totalSize: 5 });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/files/lessons/v.mp4?exp=9999999999&sig=abc',
      headers: { range: 'bytes=99-100' },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */5');
  });
});
