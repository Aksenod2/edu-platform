import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import {
  deriveStreamTeachers,
  streamTeacherSourcesInclude,
} from '../lib/stream-teachers.js';
import { enrollStudentInStream } from '../lib/stream-enroll.js';

// Публичный токен инвайт-ссылки: 32 случайных байта в base64url (URL-safe).
function generateJoinToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// Адрес фронтенда для сборки публичной ссылки вступления (как в lib/email.ts).
function joinUrlFor(token: string): string {
  const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:3000';
  return `${frontendUrl}/join/${token}`;
}

// Источник преподавателей потока перенесён в lib/stream-teachers.ts:
// поток больше не владеет уроками, они достижимы через программу
// (program.programLessons.lesson.teachers) и/или сессии (sessions.lesson.teachers).
const streamTeachersInclude = {
  owner: { select: { id: true, name: true } },
  ...streamTeacherSourcesInclude,
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
          ? { ownerId: request.user!.userId }
          : {},
      include: { ...streamTeachersInclude, _count: { select: { enrollments: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      // joinToken/joinTokenAt НЕ светим в общих ответах — только через
      // POST/DELETE /streams/:id/join-link.
      streams: streams.map(
        ({ program, sessions, owner, _count, joinToken: _jt, joinTokenAt: _jta, ...stream }) => ({
          ...stream,
          owner,
          // Число зачисленных учеников — для колонки «Учеников» в списке потоков.
          studentsCount: _count.enrollments,
          program: program
            ? { id: program.id, name: program.name, type: program.type }
            : null,
          ...deriveStreamTeachers({ program, sessions }),
        }),
      ),
    };
  });

  // POST /streams — создание потока
  // programId опционален: с ним поток привязан к программе, без него —
  // менторский поток (уроки набираются через сессии).
  app.post('/streams', { onRequest: adminOnly }, async (request, reply) => {
    const { name, programId } = request.body as { name: string; programId?: string | null };

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Название потока обязательно' });
    }

    // Если задана программа — проверяем, что она существует.
    if (programId !== undefined && programId !== null) {
      const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { id: true },
      });
      if (!program) {
        return reply.status(400).send({ error: 'Программа не найдена' });
      }
    }

    // Создающий администратор становится ведущим потока.
    const stream = await prisma.stream.create({
      data: {
        name: name.trim(),
        ownerId: request.user!.userId,
        ...(programId !== undefined && programId !== null && { programId }),
      },
    });

    return reply.status(201).send({ stream });
  });

  // PATCH /streams/:id — обновление потока (название и/или ведущий)
  app.patch('/streams/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, ownerId, programId } = request.body as {
      name?: string;
      ownerId?: string | null;
      programId?: string | null;
    };

    const existing = await prisma.stream.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (name !== undefined && !name.trim()) {
      return reply.status(400).send({ error: 'Название потока не может быть пустым' });
    }

    // Если задаётся ведущий — проверяем, что это существующий администратор.
    if (ownerId !== undefined && ownerId !== null) {
      const owner = await prisma.user.findFirst({
        where: { id: ownerId, role: 'admin', deletedAt: null },
        select: { id: true },
      });
      if (!owner) {
        return reply.status(400).send({ error: 'Ведущий должен быть существующим администратором' });
      }
    }

    // Если задаётся программа (не null) — проверяем её существование.
    // programId === null допустим: поток становится менторским (без программы).
    if (programId !== undefined && programId !== null) {
      const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { id: true },
      });
      if (!program) {
        return reply.status(400).send({ error: 'Программа не найдена' });
      }
    }

    const stream = await prisma.stream.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(ownerId !== undefined && { ownerId }),
        ...(programId !== undefined && { programId }),
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
          // Stream больше не владеет уроками — считаем сессии (фолбэк для менторских).
          select: { enrollments: true, sessions: true },
        },
        owner: { select: { id: true, name: true } },
        sessions: streamTeacherSourcesInclude.sessions,
        // program: источники преподавателей + _count.programLessons (число уроков программы).
        program: {
          select: {
            ...streamTeacherSourcesInclude.program.select,
            _count: { select: { programLessons: true } },
          },
        },
      },
    });

    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    // joinToken/joinTokenAt НЕ светим в общих ответах — только через эндпоинты join-link.
    const { _count, program, sessions, owner, joinToken: _jt, joinTokenAt: _jta, ...streamFields } = stream;
    // Число уроков: для программного потока — уроки программы; иначе — сессии.
    const lessonsCount = stream.programId
      ? program?._count.programLessons ?? 0
      : _count.sessions;
    return {
      stream: {
        ...streamFields,
        owner,
        studentsCount: _count.enrollments,
        lessonsCount,
        ...deriveStreamTeachers({ program, sessions }),
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

    // Зачисление + бэкфилл заданий — в общем хелпере (паритет с регистрацией по
    // инвайт-ссылке). Идемпотентно для каждого студента.
    for (const s of validStudents) {
      await enrollStudentInStream(id, s.id);
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

  // POST /streams/:id/join-link — получить инвайт-ссылку вступления (admin).
  // Идемпотентно: если токен уже есть — возвращаем существующий; иначе генерируем,
  // сохраняем (joinTokenAt=now) и возвращаем. Одна постоянная ссылка на поток.
  app.post('/streams/:id/join-link', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({
      where: { id },
      select: { id: true, joinToken: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (stream.joinToken) {
      return { token: stream.joinToken, joinUrl: joinUrlFor(stream.joinToken) };
    }

    const token = generateJoinToken();
    await prisma.stream.update({
      where: { id },
      data: { joinToken: token, joinTokenAt: new Date() },
    });

    return { token, joinUrl: joinUrlFor(token) };
  });

  // DELETE /streams/:id/join-link — перевыпуск инвайт-ссылки (admin).
  // Старая ссылка инвалидируется: генерируем новый токен и сохраняем (joinTokenAt=now).
  app.delete('/streams/:id/join-link', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const stream = await prisma.stream.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    const token = generateJoinToken();
    await prisma.stream.update({
      where: { id },
      data: { joinToken: token, joinTokenAt: new Date() },
    });

    return { token, joinUrl: joinUrlFor(token) };
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

  // DELETE /streams/:id — полное удаление потока (admin).
  // В отличие от архивирования удаляет поток безвозвратно. Каскад на уровне БД
  // (onDelete: Cascade) подчищает связанные StreamEnrollment, Session (и их
  // StudentAssignment) и Conversation потока. Уроки-блоки (Lesson) — переиспользуемые
  // шаблоны и НЕ удаляются.
  app.delete('/streams/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.stream.delete({ where: { id } });
    } catch (err) {
      // P2025 — запись для удаления не найдена (поток отсутствует или уже удалён).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        return reply.status(404).send({ error: 'Поток не найден' });
      }
      throw err;
    }

    return { message: 'Поток удалён' };
  });
}
