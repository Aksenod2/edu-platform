import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { authenticate, requireRole } from '../middleware/auth.js';
import { notifyMany } from '../lib/notifications.js';

export async function scheduleRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');

  // GET /schedule — список записей расписания (admin: все, student: по потоку)
  app.get('/schedule', { onRequest: authenticate }, async (request, reply) => {
    const { streamId } = request.query as { streamId?: string };

    if (!streamId) {
      return reply.status(400).send({ error: 'Параметр streamId обязателен' });
    }

    const stream = await prisma.stream.findUnique({ where: { id: streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    const entries = await prisma.scheduleEntry.findMany({
      where: { streamId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: { stream: { select: { id: true, name: true } } },
    });

    return { schedule: entries };
  });

  // POST /schedule — создание записи расписания (admin)
  app.post('/schedule', { onRequest: adminOnly }, async (request, reply) => {
    const { streamId, date, startTime, lessonTitle, notes } = request.body as {
      streamId: string;
      date: string;
      startTime: string;
      lessonTitle: string;
      notes?: string;
    };

    if (!streamId || !date || !startTime || !lessonTitle?.trim()) {
      return reply.status(400).send({ error: 'Поля streamId, date, startTime и lessonTitle обязательны' });
    }

    const stream = await prisma.stream.findUnique({ where: { id: streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    const entry = await prisma.scheduleEntry.create({
      data: {
        streamId,
        date: new Date(date),
        startTime: startTime.trim(),
        lessonTitle: lessonTitle.trim(),
        notes: notes?.trim() || null,
      },
      include: { stream: { select: { id: true, name: true } } },
    });

    // Notify all active students about the new schedule entry
    const students = await prisma.user.findMany({
      where: { role: 'student', isActive: true, deletedAt: null },
      select: { id: true },
    });
    notifyMany(
      students.map((s) => s.id),
      'schedule_entry_created',
      'Новое занятие в расписании',
      `${entry.lessonTitle} — ${new Date(entry.date).toLocaleDateString('ru-RU')} в ${entry.startTime}`,
      { scheduleEntryId: entry.id, streamId: entry.streamId },
    ).catch(() => {});

    return reply.status(201).send({ entry });
  });

  // PATCH /schedule/:id — обновление записи расписания (admin)
  app.patch('/schedule/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date, startTime, lessonTitle, notes } = request.body as {
      date?: string;
      startTime?: string;
      lessonTitle?: string;
      notes?: string | null;
    };

    const existing = await prisma.scheduleEntry.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Запись расписания не найдена' });
    }

    if (lessonTitle !== undefined && !lessonTitle.trim()) {
      return reply.status(400).send({ error: 'Название урока не может быть пустым' });
    }

    const entry = await prisma.scheduleEntry.update({
      where: { id },
      data: {
        ...(date !== undefined && { date: new Date(date) }),
        ...(startTime !== undefined && { startTime: startTime.trim() }),
        ...(lessonTitle !== undefined && { lessonTitle: lessonTitle.trim() }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
      include: { stream: { select: { id: true, name: true } } },
    });

    return { entry };
  });

  // DELETE /schedule/:id — удаление записи расписания (admin)
  app.delete('/schedule/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.scheduleEntry.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Запись расписания не найдена' });
    }

    await prisma.scheduleEntry.delete({ where: { id } });

    return { success: true };
  });
}
