import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole } from '../middleware/auth.js';

// ─── Программы (Program) ──────────────────────────────────────────────────────
//
// Program — переиспользуемый учебный план: упорядоченный набор блоков-уроков
// (через ProgramLesson, M:N с sortOrder). Поток (Stream) ссылается на программу
// через Stream.programId (nullable, onDelete SetNull). Управление программами —
// только админ.

// Допустимые типы программы (совпадают с enum ProgramType в схеме).
const PROGRAM_TYPES = ['course', 'intensive', 'mentorship'] as const;
type ProgramTypeValue = (typeof PROGRAM_TYPES)[number];

function isProgramType(value: unknown): value is ProgramTypeValue {
  return typeof value === 'string' && (PROGRAM_TYPES as readonly string[]).includes(value);
}

export async function programRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');

  // GET /programs — список программ со счётчиками (admin).
  // На каждую программу: число уроков (ProgramLesson) и число привязанных потоков.
  app.get('/programs', { onRequest: adminOnly }, async () => {
    const programs = await prisma.program.findMany({
      include: {
        _count: { select: { programLessons: true, streams: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      programs: programs.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        whatYouLearn: p.whatYouLearn,
        lessonsCount: p._count.programLessons,
        streamsCount: p._count.streams,
      })),
    };
  });

  // GET /programs/:id — деталь программы (admin).
  // Возвращает программу, упорядоченный список уроков (минимум полей) и привязанные потоки.
  app.get('/programs/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const program = await prisma.program.findUnique({
      where: { id },
      include: {
        programLessons: {
          orderBy: { sortOrder: 'asc' },
          include: {
            lesson: {
              select: {
                id: true,
                title: true,
                hasAssignment: true,
                videoUrl: true,
                videoKey: true,
              },
            },
          },
        },
        streams: {
          select: { id: true, name: true, status: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!program) {
      return reply.status(404).send({ error: 'Программа не найдена' });
    }

    return {
      program: {
        id: program.id,
        name: program.name,
        type: program.type,
        whatYouLearn: program.whatYouLearn,
        createdAt: program.createdAt,
        updatedAt: program.updatedAt,
        lessons: program.programLessons.map((pl) => ({
          id: pl.lesson.id,
          title: pl.lesson.title,
          hasAssignment: pl.lesson.hasAssignment,
          // «есть видео» — загруженный файл (videoKey) или внешняя ссылка (videoUrl).
          hasVideo: Boolean(pl.lesson.videoKey || pl.lesson.videoUrl),
          sortOrder: pl.sortOrder,
        })),
        streams: program.streams.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      },
    };
  });

  // POST /programs — создание программы (admin).
  // type валидируется по enum (дефолт course); ownerId = текущий пользователь.
  app.post('/programs', { onRequest: adminOnly }, async (request, reply) => {
    const body = request.body as {
      name?: string;
      type?: string;
      whatYouLearn?: string | null;
    };

    if (!body.name || !body.name.trim()) {
      return reply.status(400).send({ error: 'Название программы обязательно' });
    }

    let type: ProgramTypeValue = 'course';
    if (body.type !== undefined) {
      if (!isProgramType(body.type)) {
        return reply.status(400).send({ error: 'Недопустимый тип программы' });
      }
      type = body.type;
    }

    const program = await prisma.program.create({
      data: {
        name: body.name.trim(),
        type,
        ownerId: request.user!.userId,
        whatYouLearn: body.whatYouLearn?.trim() || null,
      },
    });

    return reply.status(201).send({ program });
  });

  // PATCH /programs/:id — обновление программы (admin).
  app.patch('/programs/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      type?: string;
      whatYouLearn?: string | null;
    };

    const existing = await prisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return reply.status(404).send({ error: 'Программа не найдена' });
    }

    if (body.name !== undefined && !body.name.trim()) {
      return reply.status(400).send({ error: 'Название программы не может быть пустым' });
    }

    if (body.type !== undefined && !isProgramType(body.type)) {
      return reply.status(400).send({ error: 'Недопустимый тип программы' });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.type !== undefined) data.type = body.type;
    if (body.whatYouLearn !== undefined) data.whatYouLearn = body.whatYouLearn?.trim() || null;

    const program = await prisma.program.update({ where: { id }, data });

    return { program };
  });

  // DELETE /programs/:id — удаление программы (admin).
  // ProgramLesson уходят каскадом; Stream.programId становится null (SetNull по схеме).
  app.delete('/programs/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return reply.status(404).send({ error: 'Программа не найдена' });
    }

    await prisma.program.delete({ where: { id } });

    return { message: 'Программа удалена' };
  });

  // POST /programs/:id/lessons — привязать существующий блок-урок в конец (admin).
  // Идемпотентно: если урок уже в программе — не дублируем (sortOrder = max+1).
  app.post('/programs/:id/lessons', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { lessonId } = request.body as { lessonId?: string };

    if (!lessonId) {
      return reply.status(400).send({ error: 'lessonId обязателен' });
    }

    const program = await prisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!program) {
      return reply.status(404).send({ error: 'Программа не найдена' });
    }

    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    // Идемпотентность: уже привязан — возвращаем существующую связь.
    const existing = await prisma.programLesson.findUnique({
      where: { programId_lessonId: { programId: id, lessonId } },
    });
    if (existing) {
      return reply.status(200).send({ programLesson: existing });
    }

    const last = await prisma.programLesson.findFirst({
      where: { programId: id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const programLesson = await prisma.programLesson.create({
      data: {
        programId: id,
        lessonId,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    return reply.status(201).send({ programLesson });
  });

  // DELETE /programs/:id/lessons/:lessonId — отвязать урок от программы (admin, идемпотентно).
  app.delete(
    '/programs/:id/lessons/:lessonId',
    { onRequest: adminOnly },
    async (request) => {
      const { id, lessonId } = request.params as { id: string; lessonId: string };

      await prisma.programLesson.deleteMany({
        where: { programId: id, lessonId },
      });

      return { success: true };
    },
  );

  // PATCH /programs/:id/lessons/reorder — переустановить порядок уроков (admin).
  // Принимает массив lessonIds — sortOrder выставляется по индексу в массиве (в транзакции).
  app.patch('/programs/:id/lessons/reorder', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { lessonIds } = request.body as { lessonIds?: string[] };

    if (!Array.isArray(lessonIds)) {
      return reply.status(400).send({ error: 'lessonIds должен быть массивом' });
    }

    const program = await prisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!program) {
      return reply.status(404).send({ error: 'Программа не найдена' });
    }

    // Ожидается ПОЛНЫЙ упорядоченный список уроков программы; не переданные уроки
    // сохранят прежний sortOrder. Обновляем только реально привязанные уроки (защита от чужих id).
    const existing = await prisma.programLesson.findMany({
      where: { programId: id },
      select: { lessonId: true },
    });
    const existingSet = new Set(existing.map((pl) => pl.lessonId));

    await prisma.$transaction(
      lessonIds
        .filter((lessonId) => existingSet.has(lessonId))
        .map((lessonId, index) =>
          prisma.programLesson.update({
            where: { programId_lessonId: { programId: id, lessonId } },
            data: { sortOrder: index },
          }),
        ),
    );

    const updated = await prisma.programLesson.findMany({
      where: { programId: id },
      orderBy: { sortOrder: 'asc' },
      select: { lessonId: true, sortOrder: true },
    });

    return { lessons: updated };
  });
}
