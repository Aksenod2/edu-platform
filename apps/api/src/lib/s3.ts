import { prisma } from '@platform/db';
import crypto from 'node:crypto';

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
  // No-op: PostgreSQL storage needs no bucket initialization
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

  await prisma.fileStorage.create({
    data: {
      key,
      data: Uint8Array.from(buffer),
      mimeType,
      fileName: originalName,
      size: buffer.length,
    },
  });

  return {
    key,
    url: `/files/${encodeURIComponent(key)}`,
    size: buffer.length,
  };
}

export async function getFileUrl(key: string): Promise<string> {
  // Returns an absolute, signed, time-limited URL so the browser can fetch the
  // file without permanent public access.
  return `${API_BASE_URL}${signFileUrl(key)}`;
}

export { MAX_FILE_SIZE };
