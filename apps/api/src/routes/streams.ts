import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';

export async function streamRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');

  // GET /streams — список потоков
  // Admin: все потоки; Student: только активные
  app.get('/streams', { onRequest: authenticate }, async (request) => {
    const isAdmin = request.user?.role === 'admin';
    const streams = await prisma.stream.findMany({
      where: isAdmin ? {} : { status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    return { streams };
  });

  // POST /streams — создание потока
  app.post('/streams', { onRequest: adminOnly }, async (request, reply) => {
    const { name } = request.body as { name: string };

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Название потока обязательно' });
    }

    const stream = await prisma.stream.create({
      data: { name: name.trim() },
    });

    return reply.status(201).send({ stream });
  });

  // PATCH /streams/:id — обновление потока
  app.patch('/streams/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name?: string };

    const existing = await prisma.stream.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (name !== undefined && !name.trim()) {
      return reply.status(400).send({ error: 'Название потока не может быть пустым' });
    }

    const stream = await prisma.stream.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
      },
    });

    return { stream };
  });

  // POST /streams/:id/archive — архивирование потока
  app.post('/streams/:id/archive', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.stream.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (existing.status === 'archived') {
      return reply.status(400).send({ error: 'Поток уже архивирован' });
    }

    const stream = await prisma.stream.update({
      where: { id },
      data: { status: 'archived' },
    });

    return { stream };
  });
}
