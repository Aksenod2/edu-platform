import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';

// No S3_* env in tests → s3Enabled=false → readFile() uses the PostgreSQL path.
// Mock the Prisma client to feed deterministic file bytes into readFromPostgres.
vi.mock('@platform/db', () => ({
  prisma: { fileStorage: { findUnique: vi.fn() } },
}));

import { prisma } from '@platform/db';
import { readFile } from '../s3.js';

const findUnique = vi.mocked(prisma.fileStorage.findUnique);

// "hello" = 5 bytes
const fileRow = {
  key: 'k',
  data: new Uint8Array([104, 101, 108, 108, 111]),
  mimeType: 'text/plain',
  fileName: 'h.txt',
  size: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readFile (PostgreSQL fallback) — Range', () => {
  it('нет файла → not_found', async () => {
    findUnique.mockResolvedValue(null as never);
    const res = await readFile('missing');
    expect(res.kind).toBe('not_found');
  });

  it('без Range → весь файл (isPartial=false)', async () => {
    findUnique.mockResolvedValue(fileRow as never);
    const res = await readFile('k');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.isPartial).toBe(false);
    expect(res.contentLength).toBe(5);
    expect(res.totalSize).toBe(5);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).toString()).toBe('hello');
    expect(res.start).toBe(0);
    expect(res.end).toBe(4);
  });

  it('bytes=1-3 → частичный 206-диапазон', async () => {
    findUnique.mockResolvedValue(fileRow as never);
    const res = await readFile('k', 'bytes=1-3');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.isPartial).toBe(true);
    expect(res.start).toBe(1);
    expect(res.end).toBe(3);
    expect(res.contentLength).toBe(3);
    expect((res.body as Buffer).toString()).toBe('ell');
  });

  it('bytes=-2 (суффикс) → последние 2 байта', async () => {
    findUnique.mockResolvedValue(fileRow as never);
    const res = await readFile('k', 'bytes=-2');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.start).toBe(3);
    expect(res.end).toBe(4);
    expect((res.body as Buffer).toString()).toBe('lo');
  });

  it('bytes=2- (открытый конец) → с 2 байта до конца', async () => {
    findUnique.mockResolvedValue(fileRow as never);
    const res = await readFile('k', 'bytes=2-');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.start).toBe(2);
    expect(res.end).toBe(4);
    expect((res.body as Buffer).toString()).toBe('llo');
  });

  it('диапазон за пределами файла → range_not_satisfiable', async () => {
    findUnique.mockResolvedValue(fileRow as never);
    const res = await readFile('k', 'bytes=10-20');
    expect(res.kind).toBe('range_not_satisfiable');
    if (res.kind !== 'range_not_satisfiable') return;
    expect(res.totalSize).toBe(5);
  });

  it('неразбираемый Range → отдаём весь файл', async () => {
    findUnique.mockResolvedValue(fileRow as never);
    const res = await readFile('k', 'bytes=abc');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.isPartial).toBe(false);
    expect(res.contentLength).toBe(5);
  });
});
