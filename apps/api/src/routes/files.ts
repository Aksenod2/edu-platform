import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@platform/db';
import { verifyFileSignature } from '../lib/s3.js';
import { verifyAccessToken } from '../lib/jwt.js';

/**
 * Resolve a Bearer token (JWT or `sk_` API key) to an admin user.
 * Returns true only if the request carries valid admin credentials.
 * Does not send a reply — callers decide how to respond.
 */
async function isAdminBearer(request: FastifyRequest): Promise<boolean> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);

  if (token.startsWith('sk_')) {
    const keyHash = createHash('sha256').update(token).digest('hex');
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!apiKey || apiKey.revokedAt !== null) {
      return false;
    }
    if (!apiKey.user.isActive || apiKey.user.deletedAt !== null) {
      return false;
    }

    // Fire-and-forget: update lastUsedAt
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return apiKey.user.role === 'admin';
  }

  try {
    const payload = verifyAccessToken(token);
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

export async function fileRoutes(app: FastifyInstance) {
  // GET /files/:key - serve file from PostgreSQL storage.
  // Access is granted if EITHER:
  //   (a) the query carries a valid, non-expired signature, OR
  //   (b) the request carries a valid admin Bearer token (JWT or `sk_` API key).
  app.get('/files/*', async (request, reply) => {
    const key = (request.params as Record<string, string>)['*'];

    if (!key) {
      return reply.status(400).send({ error: 'File key required' });
    }

    const { exp, sig } = request.query as { exp?: string; sig?: string };

    // (a) Signature first — never 401 before this check.
    let authorized = false;
    if (exp && sig) {
      authorized = verifyFileSignature(key, exp, sig);
    }

    // (b) Fall back to admin Bearer credentials.
    if (!authorized) {
      authorized = await isAdminBearer(request);
    }

    if (!authorized) {
      return reply.status(401).send({ error: 'Доступ запрещён' });
    }

    const file = await prisma.fileStorage.findUnique({
      where: { key },
    });

    if (!file) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const data = Buffer.from(file.data);
    const total = data.length;

    // Общие заголовки. Accept-Ranges сообщает браузеру, что можно запрашивать
    // диапазоны — это нужно для <video> (перемотка) и обязательно для Safari/iOS,
    // который не воспроизводит видео без ответа 206 на Range-запрос.
    reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', file.mimeType)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
      .header('Cache-Control', 'private, max-age=3600');

    const rangeHeader = request.headers.range;
    const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;

    if (match) {
      let start = match[1] === '' ? NaN : parseInt(match[1], 10);
      let end = match[2] === '' ? NaN : parseInt(match[2], 10);

      if (Number.isNaN(start) && !Number.isNaN(end)) {
        // bytes=-N — последние N байт
        start = Math.max(total - end, 0);
        end = total - 1;
      } else {
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= total) end = total - 1;
      }

      if (start > end || start >= total) {
        return reply.status(416).header('Content-Range', `bytes */${total}`).send();
      }

      const chunk = data.subarray(start, end + 1);
      return reply
        .status(206)
        .header('Content-Range', `bytes ${start}-${end}/${total}`)
        .header('Content-Length', chunk.length)
        .send(chunk);
    }

    return reply.header('Content-Length', total).send(data);
  });
}
