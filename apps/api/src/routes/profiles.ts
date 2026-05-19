import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { authenticate, requireRole } from '../middleware/auth.js';

export async function profileRoutes(app: FastifyInstance) {
  // GET /profiles/:studentId — profile data (student sees own, admin sees any)
  app.get('/profiles/:studentId', { onRequest: authenticate }, async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
    const user = request.user!;

    // Students can only view their own profile
    if (user.role === 'student' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    const profile = await prisma.studentProfile.findUnique({
      where: { studentId },
    });

    const result: Record<string, unknown> = {
      student,
      profile: profile
        ? {
            id: profile.id,
            resume: profile.resume,
            portfolio: profile.portfolio,
            contacts: profile.contacts,
            direction: profile.direction,
            questionnaireCompletedAt: profile.questionnaireCompletedAt,
          }
        : null,
    };

    // Admin also gets teacher notes
    if (user.role === 'admin') {
      const notes = await prisma.teacherNote.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, name: true } },
        },
      });
      result.notes = notes;
    }

    return result;
  });

  // PATCH /profiles/:studentId — student fills/updates questionnaire
  app.patch('/profiles/:studentId', { onRequest: authenticate }, async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
    const user = request.user!;

    // Only the student themselves can fill their questionnaire
    if (user.role === 'student' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }

    // Admin can also edit a student's profile
    if (user.role !== 'admin' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    const body = request.body as {
      resume?: string;
      portfolio?: string;
      contacts?: { email?: string; telegram?: string };
      direction?: string;
    };

    // Validate required fields for questionnaire completion
    const isCompleting = body.resume && body.portfolio && body.contacts && body.direction;

    const data: Record<string, unknown> = {};
    if (body.resume !== undefined) data.resume = body.resume;
    if (body.portfolio !== undefined) data.portfolio = body.portfolio;
    if (body.contacts !== undefined) data.contacts = body.contacts;
    if (body.direction !== undefined) data.direction = body.direction;

    // Check if all required fields are filled to mark questionnaire as completed
    const existing = await prisma.studentProfile.findUnique({ where: { studentId } });

    const merged = {
      resume: data.resume ?? existing?.resume,
      portfolio: data.portfolio ?? existing?.portfolio,
      contacts: data.contacts ?? existing?.contacts,
      direction: data.direction ?? existing?.direction,
    };

    const allFilled = merged.resume && merged.portfolio && merged.contacts && merged.direction;
    if (allFilled && !existing?.questionnaireCompletedAt) {
      data.questionnaireCompletedAt = new Date();
    }

    const profile = await prisma.studentProfile.upsert({
      where: { studentId },
      create: {
        studentId,
        ...data,
      },
      update: data,
    });

    return {
      profile: {
        id: profile.id,
        resume: profile.resume,
        portfolio: profile.portfolio,
        contacts: profile.contacts,
        direction: profile.direction,
        questionnaireCompletedAt: profile.questionnaireCompletedAt,
      },
    };
  });

  // POST /profiles/:studentId/notes — teacher adds a note (admin only)
  app.post('/profiles/:studentId/notes', { onRequest: requireRole('admin') }, async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
    const user = request.user!;

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    const { content } = request.body as { content: string };
    if (!content?.trim()) {
      return reply.status(400).send({ error: 'Содержание заметки обязательно' });
    }

    const note = await prisma.teacherNote.create({
      data: {
        studentId,
        authorId: user.userId,
        content: content.trim(),
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    return reply.status(201).send({ note });
  });

  // GET /profiles/:studentId/notes — list notes (admin only)
  app.get('/profiles/:studentId/notes', { onRequest: requireRole('admin') }, async (request, reply) => {
    const { studentId } = request.params as { studentId: string };

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    const notes = await prisma.teacherNote.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    return { notes };
  });
}
