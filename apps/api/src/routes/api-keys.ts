import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole } from '../middleware/auth.js';

export async function apiKeyRoutes(app: FastifyInstance) {
  // All routes require admin role
  app.addHook('preHandler', requireRole('admin'));

  // POST /api-keys — create a new API key
  app.post(
    '/api-keys',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
        },
      },
    },
    async (request, reply) => {
      const { name } = request.body as { name?: string };

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Название ключа обязательно' });
      }

      const userId = request.user!.userId;

      // Generate: sk_ + 32 hex chars (16 random bytes)
      const rawKey = `sk_${randomBytes(16).toString('hex')}`;
      const keyPrefix = rawKey.slice(0, 11); // "sk_" + 8 chars = 11 chars
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      const apiKey = await prisma.apiKey.create({
        data: {
          name: name.trim(),
          keyPrefix,
          keyHash,
          userId,
        },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          createdAt: true,
        },
      });

      // Return the full key only once
      return reply.status(201).send({
        apiKey: {
          id: apiKey.id,
          name: apiKey.name,
          key: rawKey,
          keyPrefix: apiKey.keyPrefix,
          createdAt: apiKey.createdAt,
        },
      });
    },
  );

  // GET /api-keys — list active (non-revoked) keys for current user
  app.get('/api-keys', async (request) => {
    const userId = request.user!.userId;

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { apiKeys };
  });

  // DELETE /api-keys/:id — revoke a key (soft delete)
  app.delete('/api-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    const apiKey = await prisma.apiKey.findUnique({ where: { id } });

    if (!apiKey) {
      return reply.status(404).send({ error: 'API-ключ не найден' });
    }

    if (apiKey.userId !== userId) {
      return reply.status(403).send({ error: 'Нет доступа к этому ключу' });
    }

    if (apiKey.revokedAt !== null) {
      return reply.status(400).send({ error: 'Ключ уже отозван' });
    }

    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return { message: 'Ключ отозван' };
  });
}
