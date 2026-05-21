import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { createNotification, notifyMany } from '../lib/notifications.js';

export async function assignmentRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');
  const anyAuth = authenticate;

  // GET /assignments?streamId=xxx — список заданий (опциональная фильтрация по streamId)
  // Admin: все; Student: все (фильтрация через student-assignments)
  app.get('/assignments', { onRequest: anyAuth }, async (request, reply) => {
    const { streamId } = request.query as { streamId?: string };

    if (streamId) {
      const stream = await prisma.stream.findUnique({ where: { id: streamId } });
      if (!stream) {
        return reply.status(404).send({ error: 'Поток не найден' });
      }
    }

    const assignments = await prisma.assignment.findMany({
      where: streamId ? { streamId } : {},
      include: {
        lesson: { select: { id: true, title: true } },
        _count: { select: { studentAssignments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { assignments };
  });

  // GET /assignments/:id — получить задание
  app.get('/assignments/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        lesson: { select: { id: true, title: true } },
        stream: { select: { id: true, name: true } },
        _count: { select: { studentAssignments: true } },
      },
    });

    if (!assignment) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    return { assignment };
  });

  // POST /assignments — создание задания (admin)
  app.post('/assignments', { onRequest: adminOnly }, async (request, reply) => {
    const body = request.body as {
      streamId: string;
      title: string;
      description?: string;
      type?: 'short' | 'long';
      tags?: string[];
      dueDate?: string;
      lessonId?: string;
    };

    if (!body.streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }

    if (!body.title || !body.title.trim()) {
      return reply.status(400).send({ error: 'Название задания обязательно' });
    }

    const stream = await prisma.stream.findUnique({ where: { id: body.streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (stream.status === 'archived') {
      return reply.status(400).send({ error: 'Нельзя добавлять задания в архивный поток' });
    }

    if (body.type && !['short', 'long'].includes(body.type)) {
      return reply.status(400).send({ error: 'Тип задания: short или long' });
    }

    if (body.lessonId) {
      const lesson = await prisma.lesson.findUnique({ where: { id: body.lessonId } });
      if (!lesson) {
        return reply.status(404).send({ error: 'Урок не найден' });
      }
      if (lesson.streamId !== body.streamId) {
        return reply.status(400).send({ error: 'Урок не принадлежит указанному потоку' });
      }
    }

    const assignment = await prisma.assignment.create({
      data: {
        streamId: body.streamId,
        title: body.title.trim(),
        description: body.description || null,
        type: body.type || 'short',
        tags: body.tags || [],
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        lessonId: body.lessonId || null,
      },
      include: {
        lesson: { select: { id: true, title: true } },
      },
    });

    // Notify all active students about new assignment
    const students = await prisma.user.findMany({
      where: { role: 'student', isActive: true, deletedAt: null },
      select: { id: true },
    });
    notifyMany(
      students.map((s) => s.id),
      'assignment_created',
      'Новое задание',
      `Добавлено задание «${assignment.title}»`,
      { assignmentId: assignment.id },
    ).catch(() => {});

    return reply.status(201).send({ assignment });
  });

  // PATCH /assignments/:id — обновление задания (admin)
  app.patch('/assignments/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      description?: string;
      type?: 'short' | 'long';
      tags?: string[];
      dueDate?: string | null;
      lessonId?: string | null;
    };

    const existing = await prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    if (body.title !== undefined && !body.title.trim()) {
      return reply.status(400).send({ error: 'Название задания не может быть пустым' });
    }

    if (body.type !== undefined && !['short', 'long'].includes(body.type)) {
      return reply.status(400).send({ error: 'Тип задания: short или long' });
    }

    if (body.lessonId) {
      const lesson = await prisma.lesson.findUnique({ where: { id: body.lessonId } });
      if (!lesson) {
        return reply.status(404).send({ error: 'Урок не найден' });
      }
      if (lesson.streamId !== existing.streamId) {
        return reply.status(400).send({ error: 'Урок не принадлежит потоку задания' });
      }
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.description !== undefined) data.description = body.description || null;
    if (body.type !== undefined) data.type = body.type;
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.lessonId !== undefined) data.lessonId = body.lessonId || null;

    const assignment = await prisma.assignment.update({
      where: { id },
      data,
      include: {
        lesson: { select: { id: true, title: true } },
      },
    });

    return { assignment };
  });

  // DELETE /assignments/:id — удаление задания (admin)
  app.delete('/assignments/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    await prisma.assignment.delete({ where: { id } });

    return { message: 'Задание удалено' };
  });

  // POST /assignments/:id/assign — назначить задание группе или конкретному студенту
  app.post('/assignments/:id/assign', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      studentId?: string;
      groupId?: string;
    };

    const assignment = await prisma.assignment.findUnique({ where: { id } });
    if (!assignment) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    if (body.studentId) {
      // Назначить конкретному студенту
      const student = await prisma.user.findUnique({ where: { id: body.studentId } });
      if (!student || student.role !== 'student') {
        return reply.status(404).send({ error: 'Ученик не найден' });
      }

      const existing = await prisma.studentAssignment.findUnique({
        where: { assignmentId_studentId: { assignmentId: id, studentId: body.studentId } },
      });
      if (existing) {
        return reply.status(409).send({ error: 'Задание уже назначено этому ученику' });
      }

      const sa = await prisma.studentAssignment.create({
        data: {
          assignmentId: id,
          studentId: body.studentId,
          status: 'assigned',
        },
        include: {
          student: { select: { id: true, name: true, email: true } },
        },
      });

      return reply.status(201).send({ studentAssignment: sa });
    }

    if (body.groupId) {
      // Назначить группе — в MVP группа = поток (streamId)
      // Помечаем задание как групповое и назначаем каждому студенту
      await prisma.assignment.update({
        where: { id },
        data: { groupId: body.groupId },
      });

      const students = await prisma.user.findMany({
        where: { role: 'student', isActive: true, deletedAt: null },
      });

      const results = [];
      for (const student of students) {
        const existing = await prisma.studentAssignment.findUnique({
          where: { assignmentId_studentId: { assignmentId: id, studentId: student.id } },
        });
        if (!existing) {
          const sa = await prisma.studentAssignment.create({
            data: {
              assignmentId: id,
              studentId: student.id,
              status: 'assigned',
            },
          });
          results.push(sa);
        }
      }

      return reply.status(201).send({ assigned: results.length, message: `Задание назначено ${results.length} ученикам` });
    }

    return reply.status(400).send({ error: 'Укажите studentId или groupId' });
  });

  // GET /student-assignments — список назначений ученика со статусами
  app.get('/student-assignments', { onRequest: anyAuth }, async (request, reply) => {
    const { streamId, status, studentId } = request.query as { streamId?: string; status?: string; studentId?: string };
    const isAdmin = request.user?.role === 'admin';
    const userId = request.user!.userId;

    const where: Record<string, unknown> = {};

    if (!isAdmin) {
      where.studentId = userId;
    } else if (studentId) {
      where.studentId = studentId;
    }

    if (streamId) {
      where.assignment = { ...(where.assignment as object || {}), streamId };
    }

    if (status) {
      const statuses = status.split(',').filter((s) => ['assigned', 'submitted', 'reviewed'].includes(s));
      if (statuses.length > 0) {
        where.status = { in: statuses };
      }
    }

    const studentAssignments = await prisma.studentAssignment.findMany({
      where,
      include: {
        assignment: {
          include: {
            lesson: { select: { id: true, title: true } },
            stream: { select: { id: true, name: true } },
          },
        },
        student: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { studentAssignments };
  });

  // PATCH /student-assignments/:id — смена статуса (submitted/reviewed/needs_revision)
  app.patch('/student-assignments/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status: 'submitted' | 'reviewed' | 'needs_revision' };
    const isAdmin = request.user?.role === 'admin';
    const userId = request.user!.userId;

    const sa = await prisma.studentAssignment.findUnique({
      where: { id },
      include: { assignment: true },
    });

    if (!sa) {
      return reply.status(404).send({ error: 'Назначение не найдено' });
    }

    if (!body.status || !['submitted', 'reviewed', 'needs_revision'].includes(body.status)) {
      return reply.status(400).send({ error: 'Статус: submitted, reviewed или needs_revision' });
    }

    // Студент может только отправить (submitted), админ — reviewed/needs_revision
    if (!isAdmin && sa.studentId !== userId) {
      return reply.status(403).send({ error: 'Нет доступа' });
    }

    if (!isAdmin && body.status !== 'submitted') {
      return reply.status(403).send({ error: 'Студент может только отправить задание (submitted)' });
    }

    // Студент может отправить из assigned или needs_revision (пересдача)
    if (!isAdmin && sa.status !== 'assigned' && sa.status !== 'needs_revision') {
      return reply.status(400).send({ error: 'Задание уже отправлено' });
    }

    // Админ: reviewed/needs_revision только из submitted
    if (isAdmin && (body.status === 'reviewed' || body.status === 'needs_revision') && sa.status !== 'submitted') {
      return reply.status(400).send({ error: 'Проверить можно только отправленное задание' });
    }

    const data: Record<string, unknown> = { status: body.status };
    if (body.status === 'submitted') {
      data.submittedAt = new Date();
    }
    if (body.status === 'reviewed') {
      data.reviewedAt = new Date();
    }

    const updated = await prisma.studentAssignment.update({
      where: { id },
      data,
      include: {
        assignment: {
          include: {
            lesson: { select: { id: true, title: true } },
            stream: { select: { id: true, name: true } },
          },
        },
        student: { select: { id: true, name: true, email: true } },
      },
    });

    // Notify relevant parties about status change
    if (body.status === 'submitted') {
      const admins = await prisma.user.findMany({
        where: { role: 'admin', isActive: true, deletedAt: null },
        select: { id: true },
      });
      notifyMany(
        admins.map((a) => a.id),
        'assignment_submitted',
        'Студент сдал задание',
        `${updated.student.name} сдал задание «${updated.assignment.title}»`,
        { studentAssignmentId: updated.id, assignmentId: updated.assignmentId, studentId: updated.studentId },
      ).catch(() => {});
    } else if (body.status === 'reviewed') {
      createNotification({
        userId: updated.studentId,
        type: 'assignment_reviewed',
        title: 'Задание проверено',
        body: `Ваше задание «${updated.assignment.title}» проверено преподавателем`,
        metadata: { studentAssignmentId: updated.id, assignmentId: updated.assignmentId },
      }).catch(() => {});
    } else if (body.status === 'needs_revision') {
      createNotification({
        userId: updated.studentId,
        type: 'assignment_reviewed',
        title: 'Задание на доработке',
        body: `Ваше задание «${updated.assignment.title}» возвращено на доработку`,
        metadata: { studentAssignmentId: updated.id, assignmentId: updated.assignmentId },
      }).catch(() => {});
    }

    return { studentAssignment: updated };
  });
}
