import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';

// Собирает уникальных преподавателей (admin) по всем урокам потока.
// shared = true, если в потоке преподаёт больше одного преподавателя.
function deriveStreamTeachers(
  lessons: { teachers: { user: { id: string; name: string } }[] }[],
): { teachers: { id: string; name: string }[]; shared: boolean } {
  const map = new Map<string, { id: string; name: string }>();
  for (const lesson of lessons) {
    for (const t of lesson.teachers) {
      if (!map.has(t.user.id)) {
        map.set(t.user.id, { id: t.user.id, name: t.user.name });
      }
    }
  }
  const teachers = [...map.values()];
  return { teachers, shared: teachers.length > 1 };
}

const streamTeachersInclude = {
  lessons: {
    select: {
      teachers: { include: { user: { select: { id: true, name: true } } } },
    },
  },
} as const;

export async function streamRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');

  // GET /streams — список потоков
  // Admin: все потоки (или только свои при ?mine=true); Student: только активные потоки, на которые он зачислен
  app.get('/streams', { onRequest: authenticate }, async (request) => {
    const isAdmin = request.user?.role === 'admin';
    const mine = (request.query as { mine?: string }).mine === 'true';
    const streams = await prisma.stream.findMany({
      where: !isAdmin
        ? {
            status: 'active',
            enrollments: { some: { userId: request.user!.userId } },
          }
        : mine
          ? { lessons: { some: { teachers: { some: { userId: request.user!.userId } } } } }
          : {},
      include: streamTeachersInclude,
      orderBy: { createdAt: 'desc' },
    });
    return {
      streams: streams.map(({ lessons, ...stream }) => ({
        ...stream,
        ...deriveStreamTeachers(lessons),
      })),
    };
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

  // GET /streams/:id — детали потока со счётчиками (admin)
  app.get('/streams/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({
      where: { id },
      include: {
        _count: {
          select: { enrollments: true, lessons: true },
        },
        ...streamTeachersInclude,
      },
    });

    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    const { _count, lessons, ...streamFields } = stream;
    return {
      stream: {
        ...streamFields,
        studentsCount: _count.enrollments,
        lessonsCount: _count.lessons,
        ...deriveStreamTeachers(lessons),
      },
    };
  });

  // GET /streams/:id/students — список зачисленных студентов (admin)
  app.get('/streams/:id/students', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({ where: { id } });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    const enrollments = await prisma.streamEnrollment.findMany({
      where: {
        streamId: id,
        user: { deletedAt: null },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const students = enrollments.map((e) => e.user);
    return { students };
  });

  // POST /streams/:id/students — зачисление студентов (admin)
  app.post('/streams/:id/students', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { studentIds } = request.body as { studentIds?: string[] };

    const stream = await prisma.stream.findUnique({ where: { id } });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return reply.status(400).send({ error: 'Список студентов обязателен' });
    }

    // Оставляем только существующих пользователей с ролью student (без soft-deleted)
    const validStudents = await prisma.user.findMany({
      where: {
        id: { in: studentIds },
        role: 'student',
        deletedAt: null,
      },
      select: { id: true },
    });

    if (validStudents.length > 0) {
      await prisma.streamEnrollment.createMany({
        data: validStudents.map((s) => ({ streamId: id, userId: s.id })),
        skipDuplicates: true,
      });

      // Бэкфилл: выдаём только что зачисленным студентам все существующие
      // задания потока. skipDuplicates делает повторное зачисление безопасным.
      const assignments = await prisma.assignment.findMany({
        where: { streamId: id },
        select: { id: true },
      });
      if (assignments.length > 0) {
        await prisma.studentAssignment.createMany({
          data: validStudents.flatMap((s) =>
            assignments.map((a) => ({
              assignmentId: a.id,
              studentId: s.id,
              status: 'assigned' as const,
            })),
          ),
          skipDuplicates: true,
        });
      }
    }

    const enrollments = await prisma.streamEnrollment.findMany({
      where: {
        streamId: id,
        user: { deletedAt: null },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const students = enrollments.map((e) => e.user);
    return { students };
  });

  // DELETE /streams/:id/students/:studentId — отчисление студента (admin, идемпотентно)
  app.delete(
    '/streams/:id/students/:studentId',
    { onRequest: adminOnly },
    async (request) => {
      const { id, studentId } = request.params as { id: string; studentId: string };

      await prisma.streamEnrollment.deleteMany({
        where: { streamId: id, userId: studentId },
      });

      return { success: true };
    },
  );

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
