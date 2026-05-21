import { prisma } from '@platform/db';
import crypto from 'node:crypto';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const API_BASE_URL =
  process.env.API_BASE_URL ||
  (process.env.RENDER_EXTERNAL_URL
    ? `https://${process.env.RENDER_EXTERNAL_URL}`
    : `http://localhost:${process.env.PORT || 4000}`);

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
  return `${API_BASE_URL}/files/${encodeURIComponent(key)}`;
}

export { MAX_FILE_SIZE };
