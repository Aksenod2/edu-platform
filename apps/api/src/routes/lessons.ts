import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { notifyMany } from '../lib/notifications.js';
import { isEnrolled } from '../lib/enrollment.js';

// include-конфиг для подгрузки преподавателей урока и записей расписания.
// scheduleEntries сортируем по дате — берём первую как «дату занятия» урока.
const teacherInclude = {
  teachers: { include: { user: { select: { id: true, name: true } } } },
  scheduleEntries: {
    orderBy: { date: 'asc' },
    select: { date: true, startTime: true },
  },
} as const;

type ScheduleEntrySlim = { date: Date; startTime: string };

// Производное поле «дата занятия» урока: "YYYY-MM-DDTHH:MM" из первой записи
// расписания (UTC-срез наивной @db.Date + startTime "HH:MM") или null.
function deriveScheduledAt(entries?: ScheduleEntrySlim[]): string | null {
  const entry = entries?.[0];
  if (!entry) return null;
  const datePart = entry.date.toISOString().slice(0, 10);
  return `${datePart}T${entry.startTime}`;
}

// Преобразует урок с include-преподавателями/расписанием к плоскому виду
// { teachers: [{id,name}], scheduledAt: string | null }
function shapeLesson<
  T extends {
    teachers?: { user: { id: string; name: string } }[];
    scheduleEntries?: ScheduleEntrySlim[];
  },
>(
  lesson: T,
): Omit<T, 'teachers' | 'scheduleEntries'> & {
  teachers: { id: string; name: string }[];
  scheduledAt: string | null;
} {
  const { teachers, scheduleEntries, ...rest } = lesson;
  return {
    ...rest,
    teachers: (teachers ?? []).map((t) => ({ id: t.user.id, name: t.user.name })),
    scheduledAt: deriveScheduledAt(scheduleEntries),
  };
}

// Синхронизация записи расписания (ScheduleEntry) с «датой занятия» урока.
// scheduledAt — наивная локальная строка "YYYY-MM-DDTHH:MM":
//   задана  → создаём/обновляем запись (по lessonId, первую по дате);
//   очищена → удаляем все записи урока.
// Если в строке нет времени (timePart пустой) — синхронизацию пропускаем,
// чтобы не создавать запись без startTime.
async function syncLessonSchedule(
  lesson: { id: string; streamId: string; title: string },
  scheduledAt: string | null | undefined,
): Promise<void> {
  if (scheduledAt) {
    const [datePart, timePart] = scheduledAt.split('T');
    const startTime = (timePart || '').slice(0, 5);
    if (!datePart || !startTime) return; // нет полной даты+времени — пропускаем
    const date = new Date(datePart); // @db.Date — наивная дата
    const existing = await prisma.scheduleEntry.findFirst({
      where: { lessonId: lesson.id },
      orderBy: { date: 'asc' },
    });
    if (existing) {
      await prisma.scheduleEntry.update({
        where: { id: existing.id },
        data: { date, startTime, lessonTitle: lesson.title },
      });
    } else {
      await prisma.scheduleEntry.create({
        data: {
          streamId: lesson.streamId,
          lessonId: lesson.id,
          date,
          startTime,
          lessonTitle: lesson.title,
        },
      });
    }
  } else {
    await prisma.scheduleEntry.deleteMany({ where: { lessonId: lesson.id } });
  }
}

// Оставляет из переданных id только существующих не удалённых пользователей с ролью admin
async function filterAdminIds(teacherIds: string[]): Promise<string[]> {
  const unique = [...new Set(teacherIds.filter((id) => typeof id === 'string'))];
  if (unique.length === 0) return [];
  const admins = await prisma.user.findMany({
    where: { id: { in: unique }, role: 'admin', deletedAt: null },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

export async function lessonRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');
  const anyAuth = authenticate;

  // GET /lessons?streamId=xxx&mine=true — список уроков (опциональная фильтрация по streamId)
  // Admin: все уроки (или только свои при ?mine=true); Student: только published (+ auto-publish по publishAt)
  app.get('/lessons', { onRequest: anyAuth }, async (request, reply) => {
    const { streamId, mine } = request.query as { streamId?: string; mine?: string };

    if (streamId) {
      const stream = await prisma.stream.findUnique({ where: { id: streamId } });
      if (!stream) {
        return reply.status(404).send({ error: 'Поток не найден' });
      }

      // Студент видит уроки только своих потоков
      if (request.user?.role !== 'admin' && !(await isEnrolled(request.user!.userId, streamId))) {
        return reply.status(403).send({ error: 'Нет доступа к этому потоку' });
      }
    }

    const isAdmin = request.user?.role === 'admin';
    const isMine = isAdmin && mine === 'true';
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
        ...(isMine && { teachers: { some: { userId: request.user!.userId } } }),
      },
      include: teacherInclude,
      orderBy: { sortOrder: 'asc' },
    });

    return { lessons: lessons.map(shapeLesson) };
  });

  // GET /lessons/:id — получить урок
  app.get('/lessons/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: { stream: true, assignments: true, ...teacherInclude },
    });

    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const isAdmin = request.user?.role === 'admin';

    // Студент не должен знать о существовании уроков чужих потоков → 404
    if (!isAdmin && !(await isEnrolled(request.user!.userId, lesson.streamId))) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

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

    return { lesson: shapeLesson(lesson) };
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
      scheduledAt?: string | null;
      sortOrder?: number;
      teacherIds?: string[];
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

    const teacherIds = Array.isArray(body.teacherIds)
      ? await filterAdminIds(body.teacherIds)
      : [];

    const lesson = await prisma.lesson.create({
      data: {
        streamId: body.streamId,
        title: body.title.trim(),
        videoUrl: body.videoUrl?.trim() || null,
        summary: body.summary || null,
        notes: body.notes || null,
        publishAt: body.publishAt ? new Date(body.publishAt) : null,
        sortOrder: body.sortOrder ?? 0,
        ...(teacherIds.length > 0 && {
          teachers: { create: teacherIds.map((userId) => ({ userId })) },
        }),
      },
      include: teacherInclude,
    });

    // Синхронизируем «дату занятия» с расписанием, если она передана
    await syncLessonSchedule(lesson, body.scheduledAt);

    const created = await prisma.lesson.findUnique({
      where: { id: lesson.id },
      include: teacherInclude,
    });

    return reply.status(201).send({ lesson: shapeLesson(created ?? lesson) });
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
      scheduledAt?: string | null;
      sortOrder?: number;
      teacherIds?: string[];
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

    // Замена набора преподавателей: удаляем текущие, создаём новые (только admin)
    if (body.teacherIds !== undefined) {
      const teacherIds = Array.isArray(body.teacherIds)
        ? await filterAdminIds(body.teacherIds)
        : [];
      await prisma.$transaction([
        prisma.lessonTeacher.deleteMany({ where: { lessonId: id } }),
        ...(teacherIds.length > 0
          ? [
              prisma.lessonTeacher.createMany({
                data: teacherIds.map((userId) => ({ lessonId: id, userId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    let lesson = await prisma.lesson.update({
      where: { id },
      data,
      include: teacherInclude,
    });

    // Синхронизируем «дату занятия» с расписанием ТОЛЬКО если поле передано в теле,
    // чтобы частичные апдейты без scheduledAt не удаляли запись расписания.
    // lessonTitle обновляется внутри хелпера (актуальный title уже в lesson).
    if (body.scheduledAt !== undefined) {
      await syncLessonSchedule(lesson, body.scheduledAt);
      lesson =
        (await prisma.lesson.findUnique({ where: { id }, include: teacherInclude })) ?? lesson;
    } else if (body.title !== undefined) {
      // Если поменялся только title — отразим его в существующей записи расписания
      await prisma.scheduleEntry.updateMany({
        where: { lessonId: id },
        data: { lessonTitle: lesson.title },
      });
    }

    // Notify only students enrolled in the lesson's stream when published
    if (body.status === 'published' && existing.status !== 'published') {
      const enrollments = await prisma.streamEnrollment.findMany({
        where: { streamId: lesson.streamId },
        select: { userId: true },
      });
      notifyMany(
        enrollments.map((e) => e.userId),
        'lesson_published',
        'Новый урок опубликован',
        `Урок «${lesson.title}» доступен для просмотра`,
        { lessonId: lesson.id },
      ).catch(() => {});
    }

    return { lesson: shapeLesson(lesson) };
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
