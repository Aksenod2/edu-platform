import { prisma } from '@platform/db';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const API_BASE_URL =
  process.env.API_BASE_URL ||
  (process.env.RENDER_EXTERNAL_URL
    ? `https://${process.env.RENDER_EXTERNAL_URL}`
    : `http://localhost:${process.env.PORT || 4000}`);

// Reuse the server JWT secret to sign file download capability links.
const SIGNING_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// Signed URL TTL: 1 hour.
const FILE_URL_TTL_SECONDS = 60 * 60;

// --- Хранилище: S3 (Timeweb, path-style), иначе фолбэк в PostgreSQL ----------
// Если заданы все S3_* переменные — новые файлы пишутся в объектное хранилище.
// Чтение всегда сперва пробует S3, затем PostgreSQL (чтобы старые файлы,
// загруженные до миграции, продолжали открываться).
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || 'ru-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;

const s3Enabled = Boolean(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);

const s3 = s3Enabled
  ? new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      // Timeweb S3 работает только в path-style (bucket в пути, не в поддомене).
      forcePathStyle: true,
      credentials: {
        accessKeyId: S3_ACCESS_KEY as string,
        secretAccessKey: S3_SECRET_KEY as string,
      },
    })
  : null;

export function isS3Enabled(): boolean {
  return s3Enabled;
}

function computeSignature(key: string, exp: number): string {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(`${key}.${exp}`).digest('hex');
}

/**
 * Build a signed, time-limited path for a file key:
 *   /files/<key>?exp=<unixSeconds>&sig=<hex>
 * where sig = HMAC_SHA256(secret, `${key}.${exp}`).
 */
export function signFileUrl(key: string): string {
  const exp = Math.floor(Date.now() / 1000) + FILE_URL_TTL_SECONDS;
  const sig = computeSignature(key, exp);
  return `/files/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

/**
 * Verify a file signature: constant-time compare and expiry check.
 */
export function verifyFileSignature(key: string, exp: string | number, sig: string): boolean {
  const expNum = typeof exp === 'number' ? exp : Number(exp);
  if (!Number.isFinite(expNum) || !sig) {
    return false;
  }

  // Reject expired links.
  if (expNum < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = computeSignature(key, expNum);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

export async function ensureBucketExists(): Promise<void> {
  // No-op: бакет создаётся в панели Timeweb; PostgreSQL-фолбэк не требует init.
}

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  folder: string = 'threads',
): Promise<{ key: string; url: string; size: number }> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('Файл превышает максимальный размер 50MB');
  }

  const ext = originalName.includes('.') ? originalName.split('.').pop() : '';
  const key = `${folder}/${Date.now()}-${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  if (s3 && S3_BUCKET) {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Имя файла храним в метаданных (percent-encoded — поддержка кириллицы).
        Metadata: { 'original-name': encodeURIComponent(originalName) },
      }),
    );
  } else {
    await prisma.fileStorage.create({
      data: {
        key,
        data: Uint8Array.from(buffer),
        mimeType,
        fileName: originalName,
        size: buffer.length,
      },
    });
  }

  return {
    key,
    url: `/files/${encodeURIComponent(key)}`,
    size: buffer.length,
  };
}

export async function getFileUrl(key: string): Promise<string> {
  // Returns an absolute, signed, time-limited URL so the browser can fetch the
  // file without permanent public access (через прокси-роут /files/:key).
  return `${API_BASE_URL}${signFileUrl(key)}`;
}

// --- Чтение файла (для роута GET /files/*) -----------------------------------

export type ReadFileResult =
  | {
      kind: 'ok';
      body: Buffer | Readable;
      contentType: string;
      fileName: string;
      contentLength: number; // длина тела ответа (всего файла или диапазона)
      totalSize: number; // полный размер объекта
      isPartial: boolean;
      start: number;
      end: number;
    }
  | { kind: 'not_found' }
  | { kind: 'range_not_satisfiable'; totalSize: number };

// Парсит заголовок Range против известного размера. Возвращает диапазон,
// null (нет/неподдерживаемый Range → отдать целиком) или 'invalid' (416).
function parseRange(
  rangeHeader: string | undefined,
  total: number,
): { start: number; end: number } | null | 'invalid' {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;
  let start = m[1] === '' ? NaN : parseInt(m[1], 10);
  let end = m[2] === '' ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start) && !Number.isNaN(end)) {
    start = Math.max(total - end, 0);
    end = total - 1;
  } else {
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
  }
  if (start > end || start >= total) return 'invalid';
  return { start, end };
}

async function readFromPostgres(key: string, rangeHeader?: string): Promise<ReadFileResult> {
  const file = await prisma.fileStorage.findUnique({ where: { key } });
  if (!file) return { kind: 'not_found' };

  const data = Buffer.from(file.data);
  const total = data.length;
  const range = parseRange(rangeHeader, total);

  if (range === 'invalid') return { kind: 'range_not_satisfiable', totalSize: total };

  if (range) {
    const chunk = data.subarray(range.start, range.end + 1);
    return {
      kind: 'ok',
      body: chunk,
      contentType: file.mimeType,
      fileName: file.fileName,
      contentLength: chunk.length,
      totalSize: total,
      isPartial: true,
      start: range.start,
      end: range.end,
    };
  }

  return {
    kind: 'ok',
    body: data,
    contentType: file.mimeType,
    fileName: file.fileName,
    contentLength: total,
    totalSize: total,
    isPartial: false,
    start: 0,
    end: total - 1,
  };
}

function isS3NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

function fileNameFromKey(key: string): string {
  const base = key.split('/').pop() || key;
  return base;
}

async function readFromS3(key: string, rangeHeader?: string): Promise<ReadFileResult | null> {
  if (!s3 || !S3_BUCKET) return null;
  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      }),
    );

    const metaName = out.Metadata?.['original-name'];
    const fileName = metaName ? decodeURIComponent(metaName) : fileNameFromKey(key);
    const contentType = out.ContentType || 'application/octet-stream';
    const body = out.Body as unknown as Readable;
    const contentLength = out.ContentLength ?? 0;

    // ContentRange вида "bytes start-end/total" присутствует при частичном ответе.
    if (out.ContentRange) {
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(out.ContentRange);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m ? parseInt(m[2], 10) : contentLength - 1;
      const total = m ? parseInt(m[3], 10) : contentLength;
      return {
        kind: 'ok',
        body,
        contentType,
        fileName,
        contentLength,
        totalSize: total,
        isPartial: true,
        start,
        end,
      };
    }

    return {
      kind: 'ok',
      body,
      contentType,
      fileName,
      contentLength,
      totalSize: contentLength,
      isPartial: false,
      start: 0,
      end: Math.max(contentLength - 1, 0),
    };
  } catch (err) {
    if (isS3NotFound(err)) return null; // нет в S3 → попробуем PostgreSQL
    if ((err as { name?: string }).name === 'InvalidRange') {
      return { kind: 'range_not_satisfiable', totalSize: 0 };
    }
    throw err;
  }
}

/**
 * Читает файл по ключу для отдачи через роут /files/*. Сначала пробует S3
 * (если настроен), затем PostgreSQL — чтобы файлы, загруженные до миграции,
 * продолжали открываться. Поддерживает HTTP Range.
 */
export async function readFile(key: string, rangeHeader?: string): Promise<ReadFileResult> {
  if (s3Enabled) {
    const fromS3 = await readFromS3(key, rangeHeader);
    if (fromS3) return fromS3;
  }
  return readFromPostgres(key, rangeHeader);
}

export { MAX_FILE_SIZE };
