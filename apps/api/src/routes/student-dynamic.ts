import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole } from '../middleware/auth.js';

// «Динамика ученика» — ПРИВАТНЫЙ инструмент преподавателя/админа: markdown-конспект
// прогресса ученика в формате ГИБРИД (roadmap-шапка + лента датированных записей).
// КРИТИЧНО: ученик НЕ имеет доступа — ВСЕ роуты под requireRole('admin'). Поэтому
// «Динамику» НЕЛЬЗЯ подмешивать в студенческие/публичные ответы и в /users/:id/export.
//
// Фаза 2 (НЕ сейчас): Claude-автозаполнение записей из транскрипта. Поле source у записи
// (manual | ai_transcript) — задел под неё; здесь мы всегда пишем source='manual'.

// Лимиты длины markdown: защищаемся от гигантских полей (DoS/случайная вставка).
const MAX_ROADMAP_LENGTH = 50_000;
const MAX_ENTRY_LENGTH = 50_000;

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CREATED = 201;

// Проверка, что :id — существующий НЕ удалённый ученик (role='student').
// Возвращает true, если ученик найден; иначе сам шлёт 404 и возвращает false.
async function ensureStudent(id: string, reply: import('fastify').FastifyReply): Promise<boolean> {
  const student = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, deletedAt: true },
  });

  if (!student || student.role !== 'student' || student.deletedAt !== null) {
    reply.status(HTTP_NOT_FOUND).send({ error: 'Студент не найден' });
    return false;
  }

  return true;
}

export async function studentDynamicRoutes(app: FastifyInstance) {
  // ВСЕ роуты «Динамики» только для admin (преподаватель = admin). Ученик не имеет доступа.
  app.addHook('preHandler', requireRole('admin'));

  // GET /students/:id/dynamic — roadmap-шапка + лента записей (desc по createdAt).
  // Если roadmap-шапки ещё нет — roadmap:null, entries:[] (страница «пустая, но валидная»).
  app.get('/students/:id/dynamic', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!(await ensureStudent(id, reply))) return;

    const [dynamic, entries] = await Promise.all([
      prisma.studentDynamic.findUnique({
        where: { studentId: id },
        include: { updatedBy: { select: { name: true } } },
      }),
      prisma.studentDynamicEntry.findMany({
        where: { studentId: id },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      roadmap: dynamic?.roadmap ?? null,
      updatedAt: dynamic?.updatedAt ?? null,
      updatedByName: dynamic?.updatedBy?.name ?? null,
      entries: entries.map((e) => ({
        id: e.id,
        content: e.content,
        source: e.source,
        authorName: e.author?.name ?? null,
        lessonId: e.lessonId,
        sessionId: e.sessionId,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    };
  });

  // PUT /students/:id/dynamic/roadmap — upsert roadmap-шапки (одна на ученика).
  app.put('/students/:id/dynamic/roadmap', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { roadmap?: unknown };

    if (typeof body?.roadmap !== 'string') {
      return reply.status(HTTP_BAD_REQUEST).send({ error: 'roadmap должен быть строкой' });
    }
    if (body.roadmap.length > MAX_ROADMAP_LENGTH) {
      return reply
        .status(HTTP_BAD_REQUEST)
        .send({ error: `roadmap слишком длинный (максимум ${MAX_ROADMAP_LENGTH} символов)` });
    }

    if (!(await ensureStudent(id, reply))) return;

    const adminId = request.user!.userId;

    const dynamic = await prisma.studentDynamic.upsert({
      where: { studentId: id },
      create: { studentId: id, roadmap: body.roadmap, updatedById: adminId },
      update: { roadmap: body.roadmap, updatedById: adminId },
      include: { updatedBy: { select: { name: true } } },
    });

    return {
      roadmap: dynamic.roadmap,
      updatedAt: dynamic.updatedAt,
      updatedByName: dynamic.updatedBy?.name ?? null,
    };
  });

  // POST /students/:id/dynamic/entries — добавить запись в ленту (source='manual').
  app.post('/students/:id/dynamic/entries', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      content?: unknown;
      lessonId?: unknown;
      sessionId?: unknown;
    };

    if (typeof body?.content !== 'string' || body.content.trim().length === 0) {
      return reply.status(HTTP_BAD_REQUEST).send({ error: 'content обязателен и должен быть непустым' });
    }
    if (body.content.length > MAX_ENTRY_LENGTH) {
      return reply
        .status(HTTP_BAD_REQUEST)
        .send({ error: `content слишком длинный (максимум ${MAX_ENTRY_LENGTH} символов)` });
    }
    if (body.lessonId !== undefined && body.lessonId !== null && typeof body.lessonId !== 'string') {
      return reply.status(HTTP_BAD_REQUEST).send({ error: 'lessonId должен быть строкой' });
    }
    if (body.sessionId !== undefined && body.sessionId !== null && typeof body.sessionId !== 'string') {
      return reply.status(HTTP_BAD_REQUEST).send({ error: 'sessionId должен быть строкой' });
    }

    if (!(await ensureStudent(id, reply))) return;

    const adminId = request.user!.userId;

    const entry = await prisma.studentDynamicEntry.create({
      data: {
        studentId: id,
        authorId: adminId,
        content: body.content,
        source: 'manual',
        lessonId: (body.lessonId as string | undefined) ?? null,
        sessionId: (body.sessionId as string | undefined) ?? null,
      },
      include: { author: { select: { name: true } } },
    });

    return reply.status(HTTP_CREATED).send({
      entry: {
        id: entry.id,
        content: entry.content,
        source: entry.source,
        authorName: entry.author?.name ?? null,
        lessonId: entry.lessonId,
        sessionId: entry.sessionId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    });
  });

  // PATCH /students/:id/dynamic/entries/:entryId — отредактировать текст записи.
  app.patch('/students/:id/dynamic/entries/:entryId', async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string };
    const body = request.body as { content?: unknown };

    if (typeof body?.content !== 'string' || body.content.trim().length === 0) {
      return reply.status(HTTP_BAD_REQUEST).send({ error: 'content обязателен и должен быть непустым' });
    }
    if (body.content.length > MAX_ENTRY_LENGTH) {
      return reply
        .status(HTTP_BAD_REQUEST)
        .send({ error: `content слишком длинный (максимум ${MAX_ENTRY_LENGTH} символов)` });
    }

    // Запись должна существовать И принадлежать этому ученику (защита от чужого entryId).
    const existing = await prisma.studentDynamicEntry.findUnique({
      where: { id: entryId },
      select: { id: true, studentId: true },
    });
    if (!existing || existing.studentId !== id) {
      return reply.status(HTTP_NOT_FOUND).send({ error: 'Запись не найдена' });
    }

    const entry = await prisma.studentDynamicEntry.update({
      where: { id: entryId },
      data: { content: body.content },
      include: { author: { select: { name: true } } },
    });

    return {
      entry: {
        id: entry.id,
        content: entry.content,
        source: entry.source,
        authorName: entry.author?.name ?? null,
        lessonId: entry.lessonId,
        sessionId: entry.sessionId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    };
  });

  // DELETE /students/:id/dynamic/entries/:entryId — удалить запись ленты.
  app.delete('/students/:id/dynamic/entries/:entryId', async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string };

    const existing = await prisma.studentDynamicEntry.findUnique({
      where: { id: entryId },
      select: { id: true, studentId: true },
    });
    if (!existing || existing.studentId !== id) {
      return reply.status(HTTP_NOT_FOUND).send({ error: 'Запись не найдена' });
    }

    await prisma.studentDynamicEntry.delete({ where: { id: entryId } });

    return { ok: true };
  });
}
