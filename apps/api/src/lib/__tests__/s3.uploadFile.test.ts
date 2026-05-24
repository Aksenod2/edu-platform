import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// Без S3_* env → s3Enabled=false → uploadFile пишет в PostgreSQL-фолбэк.
// Мокаем Prisma, чтобы create не ходил в реальную БД; нас интересует только
// форма возвращаемого ключа (расширение).
vi.mock('@platform/db', () => ({
  prisma: { fileStorage: { create: vi.fn(async () => ({})) } },
}));

import { uploadFile } from '../s3.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// Извлекает расширение из ключа вида `folder/<ts>-<uuid>.<ext>`.
function extOf(key: string): string {
  const base = key.split('/').pop() ?? '';
  return base.includes('.') ? (base.split('.').pop() ?? '') : '';
}

describe('uploadFile — нормализация расширения ключа по mime', () => {
  it('image/png → .png даже если имя файла .txt', async () => {
    const { key } = await uploadFile(Buffer.from('x'), 'x.txt', 'image/png', 'payment');
    expect(extOf(key)).toBe('png');
    expect(key.startsWith('payment/')).toBe(true);
  });

  it('image/jpeg → .jpg', async () => {
    const { key } = await uploadFile(Buffer.from('x'), 'photo.bin', 'image/jpeg');
    expect(extOf(key)).toBe('jpg');
  });

  it('image/webp → .webp', async () => {
    const { key } = await uploadFile(Buffer.from('x'), 'noext', 'image/webp');
    expect(extOf(key)).toBe('webp');
  });

  it('mime в верхнем регистре тоже нормализуется (IMAGE/PNG → .png)', async () => {
    const { key } = await uploadFile(Buffer.from('x'), 'x.txt', 'IMAGE/PNG');
    expect(extOf(key)).toBe('png');
  });

  it('неизвестный mime → расширение берётся из имени файла (прежнее поведение)', async () => {
    const { key } = await uploadFile(Buffer.from('x'), 'doc.pdf', 'application/pdf');
    expect(extOf(key)).toBe('pdf');
  });

  it('неизвестный mime и имя без расширения → ключ без расширения', async () => {
    const { key } = await uploadFile(Buffer.from('x'), 'noext', 'application/octet-stream');
    expect(extOf(key)).toBe('');
  });

  it('возвращаемая форма не меняется: key/url/size', async () => {
    const buf = Buffer.from('hello');
    const res = await uploadFile(buf, 'x.txt', 'image/png', 'payment');
    expect(res.size).toBe(buf.length);
    expect(res.url).toBe(`/files/${encodeURIComponent(res.key)}`);
  });
});
