import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { createNotification, notifyMany } from '../lib/notifications.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

export interface AssignmentMaterial {
  type: 'file' | 'url';
  name: string;
  url: string;
  size?: number;
  s3Key?: string;
}

async function regenerateMaterialUrls(materials: AssignmentMaterial[]): Promise<AssignmentMaterial[]> {
  return Promise.all(
    materials.map(async (m) => {
      if (m.type === 'file' && m.s3Key) {
        try {
          const signedUrl = await getFileUrl(m.s3Key);
          return { ...m, url: signedUrl };
        } catch {
          return m;
        }
      }
      return m;
    }),
  );
}

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

    const assignmentsWithUrls = await Promise.all(
      assignments.map(async (a) => ({
        ...a,
        materials: await regenerateMaterialUrls((a.materials as unknown as AssignmentMaterial[]) || []),
      })),
    );

    return { assignments: assignmentsWithUrls };
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

    const materials = await regenerateMaterialUrls((assignment.materials as unknown as AssignmentMaterial[]) || []);

    return { assignment: { ...assignment, materials } };
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
      materials?: AssignmentMaterial[];
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
        materials: JSON.parse(JSON.stringify(Array.isArray(body.materials) ? body.materials : [])),
      },
      include: {
        lesson: { select: { id: true, title: true } },
      },
    });

    // Notify only students enrolled in the assignment's stream
    const enrollments = await prisma.streamEnrollment.findMany({
      where: { streamId: body.streamId },
      select: { userId: true },
    });
    notifyMany(
      enrollments.map((e) => e.userId),
      'assignment_created',
      'Новое задание',
      `Добавлено задание «${assignment.title}»`,
      { assignmentId: assignment.id, streamId: body.streamId },
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
      materials?: AssignmentMaterial[];
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
    if (body.materials !== undefined) data.materials = JSON.parse(JSON.stringify(Array.isArray(body.materials) ? body.materials : []));

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

  // POST /assignments/upload-material — upload a file to S3 for use as assignment material (admin)
  app.post('/assignments/upload-material', { onRequest: adminOnly }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const chunks: Buffer[] = [];
    await pipeline(
      data.file,
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
    );

    const buffer = Buffer.concat(chunks);
    const mimeType = data.mimetype || 'application/octet-stream';
    const originalName = data.filename || 'file';

    const { key, url, size } = await uploadFile(buffer, originalName, mimeType, 'assignments');

    const material: AssignmentMaterial = {
      type: 'file',
      name: originalName,
      url,
      size,
      s3Key: key,
    };

    return reply.status(201).send({ material });
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

  // POST /assignments/:assignmentId/assign-stream — назначить задание всем студентам потока (admin)
  app.post('/assignments/:assignmentId/assign-stream', { onRequest: adminOnly }, async (request, reply) => {
    const { assignmentId } = request.params as { assignmentId: string };
    const { streamId } = request.body as { streamId?: string };

    if (!streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }

    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    if (assignment.streamId !== streamId) {
      return reply.status(400).send({ error: 'Задание не принадлежит указанному потоку' });
    }

    // Студенты, зачисленные на поток
    const enrollments = await prisma.streamEnrollment.findMany({
      where: { streamId },
      select: { userId: true },
    });
    const studentIds = enrollments.map((e) => e.userId);

    if (studentIds.length === 0) {
      return reply.send({ assigned: 0 });
    }

    const result = await prisma.studentAssignment.createMany({
      data: studentIds.map((studentId) => ({
        assignmentId,
        studentId,
        status: 'assigned' as const,
      })),
      skipDuplicates: true,
    });

    // Уведомляем только зачисленных студентов о новом задании
    notifyMany(
      studentIds,
      'assignment_created',
      'Новое задание',
      `Вам назначено задание «${assignment.title}»`,
      { assignmentId: assignment.id, streamId },
    ).catch(() => {});

    return reply.send({ assigned: result.count });
  });

  // GET /students/:id/assignments-summary — сводная статистика по статусам для ученика (admin)
  app.get('/students/:id/assignments-summary', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const student = await prisma.user.findUnique({ where: { id } });
    if (!student || student.role !== 'student') {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    const now = new Date();

    const statusCounts = await prisma.studentAssignment.groupBy({
      by: ['status'],
      where: { studentId: id },
      _count: { status: true },
    });

    const overdueCount = await prisma.studentAssignment.count({
      where: {
        studentId: id,
        status: { not: 'reviewed' },
        assignment: { dueDate: { lt: now, not: null } },
      },
    });

    const summary: Record<string, number> = {
      assigned: 0,
      submitted: 0,
      reviewed: 0,
      needs_revision: 0,
      overdue: overdueCount,
      total: 0,
    };

    for (const item of statusCounts) {
      summary[item.status] = item._count.status;
      summary.total += item._count.status;
    }

    return { summary };
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
      const statuses = status.split(',').filter((s) => ['assigned', 'submitted', 'reviewed', 'needs_revision'].includes(s));
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

    // Generate signed URLs for files (submission files + assignment materials)
    const results = await Promise.all(
      studentAssignments.map(async (sa) => {
        let updated: typeof sa & { fileSignedUrl?: string } = sa;
        if (sa.fileUrl) {
          updated = { ...updated, fileSignedUrl: await getFileUrl(sa.fileUrl) };
        }
        if (updated.assignment) {
          const materials = await regenerateMaterialUrls((updated.assignment.materials as unknown as AssignmentMaterial[]) || []);
          updated = { ...updated, assignment: { ...updated.assignment, materials: materials as unknown as typeof updated.assignment.materials } };
        }
        return updated;
      }),
    );

    return { studentAssignments: results };
  });

  // PATCH /student-assignments/:id — смена статуса + ответ (текст/файл)
  // Принимает JSON или multipart/form-data (когда есть файл)
  app.patch('/student-assignments/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const isAdmin = request.user?.role === 'admin';
    const userId = request.user!.userId;

    // Parse body: JSON or multipart
    let status: string | undefined;
    let answerText: string | undefined;
    let studentComment: string | undefined;
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileMimeType = '';

    const contentType = request.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
          fileName = part.filename;
          fileMimeType = part.mimetype;
        } else if (part.type === 'field') {
          const value = part.value as string;
          if (part.fieldname === 'status') status = value;
          else if (part.fieldname === 'answerText') answerText = value;
          else if (part.fieldname === 'studentComment') studentComment = value;
        }
      }
    } else {
      const body = request.body as Record<string, string>;
      status = body.status;
      answerText = body.answerText;
      studentComment = body.studentComment;
    }

    const sa = await prisma.studentAssignment.findUnique({
      where: { id },
      include: { assignment: true },
    });

    if (!sa) {
      return reply.status(404).send({ error: 'Назначение не найдено' });
    }

    if (!status || !['submitted', 'reviewed', 'needs_revision'].includes(status)) {
      return reply.status(400).send({ error: 'Статус: submitted, reviewed или needs_revision' });
    }

    // Студент может только отправить (submitted), админ — reviewed/needs_revision
    if (!isAdmin && sa.studentId !== userId) {
      return reply.status(403).send({ error: 'Нет доступа' });
    }

    if (!isAdmin && status !== 'submitted') {
      return reply.status(403).send({ error: 'Студент может только отправить задание (submitted)' });
    }

    // Студент может отправить из assigned или needs_revision (пересдача)
    if (!isAdmin && sa.status !== 'assigned' && sa.status !== 'needs_revision') {
      return reply.status(400).send({ error: 'Задание уже отправлено' });
    }

    // Админ: reviewed/needs_revision только из submitted
    if (isAdmin && (status === 'reviewed' || status === 'needs_revision') && sa.status !== 'submitted') {
      return reply.status(400).send({ error: 'Проверить можно только отправленное задание' });
    }

    const data: Record<string, unknown> = { status };
    if (status === 'submitted') {
      data.submittedAt = new Date();
      if (answerText) data.content = answerText;
      if (studentComment) data.studentComment = studentComment;

      // Upload file if provided
      if (fileBuffer && fileName) {
        const uploaded = await uploadFile(fileBuffer, fileName, fileMimeType);
        data.fileUrl = uploaded.key;
        data.fileName = fileName;
        data.fileSize = uploaded.size;
      }
    }
    if (status === 'reviewed') {
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

    // Create ThreadEntry for submission so teacher sees it in thread
    if (status === 'submitted') {
      // Auto-create thread if not yet exists (student may not have visited thread page)
      let thread = await prisma.thread.findUnique({
        where: { studentId: sa.studentId },
      });
      if (!thread) {
        thread = await prisma.thread.create({ data: { studentId: sa.studentId } });
      }

      if (thread) {
        const entryContent = answerText || `Сдано задание «${updated.assignment.title}»`;
        const entryMetadata: Record<string, unknown> = {
          submissionType: 'assignment',
          studentAssignmentId: updated.id,
        };

        if (updated.fileUrl) {
          entryMetadata.s3Key = updated.fileUrl;
          entryMetadata.fileName = updated.fileName;
          entryMetadata.mimeType = fileMimeType || null;
          entryMetadata.size = updated.fileSize;
        }

        await prisma.threadEntry.create({
          data: {
            threadId: thread.id,
            authorId: sa.studentId,
            type: updated.fileUrl ? 'file' : 'text',
            content: entryContent,
            metadata: (entryMetadata as Parameters<typeof prisma.threadEntry.create>[0]['data']['metadata']),
            assignmentId: sa.assignmentId,
          },
        });
      }
    }

    // Generate signed URL for file if present
    if (updated.fileUrl) {
      (updated as Record<string, unknown>).fileSignedUrl = await getFileUrl(updated.fileUrl);
    }

    // Notify relevant parties about status change
    if (status === 'submitted') {
      // Адресно: уведомляем преподавателей урока, к которому привязано задание.
      // Если урока/преподавателей нет — фолбэк на всех админов.
      let recipientIds: string[] = [];
      if (updated.assignment.lessonId) {
        const lessonTeachers = await prisma.lessonTeacher.findMany({
          where: {
            lessonId: updated.assignment.lessonId,
            user: { isActive: true, deletedAt: null },
          },
          select: { userId: true },
        });
        recipientIds = lessonTeachers.map((t) => t.userId);
      }
      if (recipientIds.length === 0) {
        const admins = await prisma.user.findMany({
          where: { role: 'admin', isActive: true, deletedAt: null },
          select: { id: true },
        });
        recipientIds = admins.map((a) => a.id);
      }
      notifyMany(
        recipientIds,
        'assignment_submitted',
        'Студент сдал задание',
        `${updated.student.name} сдал задание «${updated.assignment.title}»`,
        { studentAssignmentId: updated.id, assignmentId: updated.assignmentId, studentId: updated.studentId },
      ).catch(() => {});
    } else if (status === 'reviewed') {
      createNotification({
        userId: updated.studentId,
        type: 'assignment_reviewed',
        title: 'Задание проверено',
        body: `Ваше задание «${updated.assignment.title}» проверено преподавателем`,
        metadata: { studentAssignmentId: updated.id, assignmentId: updated.assignmentId },
      }).catch(() => {});
    } else if (status === 'needs_revision') {
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
