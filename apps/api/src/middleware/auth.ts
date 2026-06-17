import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, type JwtPayload } from '../lib/jwt.js';
import { prisma } from '@platform/db';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

/**
 * ИНВАРИАНТ (issue #119): authenticate подключается ТОЛЬКО в фазе onRequest
 * ({ onRequest: authenticate } на роуте или addHook('onRequest', ...) в плагине),
 * НЕ в preHandler. Глобальный preHandler-гейт согласий (middleware/consent-gate.ts)
 * полагается на то, что request.user уже установлен; authenticate в preHandler
 * выполнился бы ПОЗЖЕ гейта, и студент с недоданными согласиями молча обошёл бы
 * его. Инвариант закреплён тестом в __tests__/consent-gate.test.ts.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Токен не предоставлен' });
  }

  const token = authHeader.slice(7);

  if (token.startsWith('sk_')) {
    // API key authentication
    const keyHash = createHash('sha256').update(token).digest('hex');
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!apiKey || apiKey.revokedAt !== null) {
      return reply.status(401).send({ error: 'Невалидный или отозванный API-ключ' });
    }

    if (!apiKey.user.isActive || apiKey.user.deletedAt !== null) {
      return reply.status(401).send({ error: 'Пользователь неактивен' });
    }

    // Fire-and-forget: update lastUsedAt
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    request.user = { userId: apiKey.user.id, role: apiKey.user.role };
    return;
  }

  // JWT authentication
  try {
    request.user = verifyAccessToken(token);
  } catch {
    return reply.status(401).send({ error: 'Невалидный или просроченный токен' });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply);
    if (reply.sent) return;

    if (!request.user || !roles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }
  };
}
