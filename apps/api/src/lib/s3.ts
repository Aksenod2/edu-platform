import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET || 'platform-uploads';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<{ key: string; url: string; size: number }> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('Файл превышает максимальный размер 50MB');
  }

  const ext = originalName.includes('.') ? originalName.split('.').pop() : '';
  const key = `threads/${Date.now()}-${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return {
    key,
    url: `/${BUCKET}/${key}`,
    size: buffer.length,
  };
}

export async function getFileUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

export { MAX_FILE_SIZE };
