import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';

export async function lessonRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');
  const anyAuth = authenticate;

  // GET /lessons?streamId=xxx — список уроков (опциональная фильтрация по streamId)
  // Admin: все уроки; Student: только published (+ auto-publish по publishAt)
  app.get('/lessons', { onRequest: anyAuth }, async (request, reply) => {
    const { streamId } = request.query as { streamId?: string };

    if (streamId) {
      const stream = await prisma.stream.findUnique({ where: { id: streamId } });
      if (!stream) {
        return reply.status(404).send({ error: 'Поток не найден' });
      }
    }

    const isAdmin = request.user?.role === 'admin';
    const streamFilter = streamId ? { streamId } : {};

    // Auto-publish: переводим draft → published если publishAt <= now
    await prisma.lesson.updateMany({
      where: {
        ...streamFilter,
        status: 'draft',
        publishAt: { lte: new Date() },
      },
      data: { status: 'published' },
    });

    const lessons = await prisma.lesson.findMany({
      where: {
        ...streamFilter,
        ...(!isAdmin && { status: { in: ['published', 'closed'] } }),
      },
      orderBy: { sortOrder: 'asc' },
    });

    return { lessons };
  });

  // GET /lessons/:id — получить урок
  app.get('/lessons/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: { stream: true },
    });

    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const isAdmin = request.user?.role === 'admin';

    // Auto-publish при чтении конкретного урока
    if (lesson.status === 'draft' && lesson.publishAt && lesson.publishAt <= new Date()) {
      await prisma.lesson.update({
        where: { id },
        data: { status: 'published' },
      });
      lesson.status = 'published';
    }

    // Студент не видит draft-уроки
    if (!isAdmin && lesson.status === 'draft') {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    return { lesson };
  });

  // POST /lessons — создание урока (admin)
  app.post('/lessons', { onRequest: adminOnly }, async (request, reply) => {
    const body = request.body as {
      streamId: string;
      title: string;
      videoUrl?: string;
      summary?: string;
      notes?: string;
      publishAt?: string;
      sortOrder?: number;
    };

    if (!body.streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }

    if (!body.title || !body.title.trim()) {
      return reply.status(400).send({ error: 'Название урока обязательно' });
    }

    const stream = await prisma.stream.findUnique({ where: { id: body.streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (stream.status === 'archived') {
      return reply.status(400).send({ error: 'Нельзя добавлять уроки в архивный поток' });
    }

    const lesson = await prisma.lesson.create({
      data: {
        streamId: body.streamId,
        title: body.title.trim(),
        videoUrl: body.videoUrl?.trim() || null,
        summary: body.summary || null,
        notes: body.notes || null,
        publishAt: body.publishAt ? new Date(body.publishAt) : null,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    return reply.status(201).send({ lesson });
  });

  // PATCH /lessons/:id — обновление урока (admin)
  app.patch('/lessons/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      videoUrl?: string;
      summary?: string;
      notes?: string;
      status?: 'draft' | 'published' | 'closed';
      publishAt?: string | null;
      sortOrder?: number;
    };

    const existing = await prisma.lesson.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    if (body.title !== undefined && !body.title.trim()) {
      return reply.status(400).send({ error: 'Название урока не может быть пустым' });
    }

    if (body.status !== undefined && !['draft', 'published', 'closed'].includes(body.status)) {
      return reply.status(400).send({ error: 'Недопустимый статус' });
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.videoUrl !== undefined) data.videoUrl = body.videoUrl.trim() || null;
    if (body.summary !== undefined) data.summary = body.summary || null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.status !== undefined) data.status = body.status;
    if (body.publishAt !== undefined) data.publishAt = body.publishAt ? new Date(body.publishAt) : null;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const lesson = await prisma.lesson.update({
      where: { id },
      data,
    });

    return { lesson };
  });

  // DELETE /lessons/:id — удаление урока (admin)
  app.delete('/lessons/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.lesson.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    await prisma.lesson.delete({ where: { id } });

    return { message: 'Урок удалён' };
  });
}
