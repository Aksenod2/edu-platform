import type { FastifyInstance } from 'fastify';
import { prisma, type ThreadEntryType } from '@platform/db';
import { authenticate } from '../middleware/auth.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { createNotification } from '../lib/notifications.js';
import { deriveStreamTeachers, streamTeacherSourcesInclude } from '../lib/stream-teachers.js';

/**
 * Получатели уведомления о сообщении студента в его личном треде.
 *
 * Уведомление о сообщении студента адресуется ПРЕПОДАВАТЕЛЯМ его потоков (всех
 * потоков, на которые студент зачислён), а НЕ всем админам. Список дедуплицируется
 * по id (один препод, ведущий несколько потоков/уроков студента, получает одно
 * уведомление) и фильтруется по активности.
 *
 * Фолбэк на админов — ТОЛЬКО если у потоков студента нет активных преподавателей
 * (или у студента вовсе нет потоков), чтобы сообщение не осталось без адресата.
 */
async function recipientsForStudentThread(studentId: string): Promise<string[]> {
  const enrollments = await prisma.streamEnrollment.findMany({
    where: { userId: studentId },
    select: { streamId: true },
  });

  const teacherIds = new Set<string>();
  if (enrollments.length > 0) {
    // Один запрос на все потоки студента вместо N тяжёлых запросов в цикле.
    const streams = await prisma.stream.findMany({
      where: { id: { in: enrollments.map((e) => e.streamId) } },
      select: streamTeacherSourcesInclude,
    });
    for (const stream of streams) {
      for (const t of deriveStreamTeachers(stream).teachers) teacherIds.add(t.id);
    }
  }

  if (teacherIds.size > 0) {
    // Отсеиваем неактивных/удалённых преподавателей (список их флагов не несёт).
    const active = await prisma.user.findMany({
      where: { id: { in: [...teacherIds] }, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (active.length > 0) return active.map((u) => u.id);
  }

  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true, deletedAt: null },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

const ALLOWED_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link', 'comment', 'note'];
const STUDENT_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link'];
const ADMIN_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link', 'comment', 'note'];

// Контекст «вопрос по заданию» приходит из веба как lessonId ИЛИ как синтетический
// id задания (= sessionId, т.к. задание свёрнуто в Session). Возвращаем реальный
// lessonId, либо null если ни Lesson, ни Session с таким id нет.
async function resolveContextLessonId(rawId: string): Promise<string | null> {
  const lesson = await prisma.lesson.findUnique({ where: { id: rawId }, select: { id: true } });
  if (lesson) return lesson.id;
  const session = await prisma.session.findUnique({
    where: { id: rawId },
    select: { lessonId: true },
  });
  return session?.lessonId ?? null;
}

// Web-facing compatibility (this wave): the model moved `assignment` onto the Lesson
// block (entry.lessonId/lesson вместо assignmentId/assignment). Веб ещё читает
// `entry.assignmentId` (для группировки) и `entry.assignment.title` (бейдж задания),
// поэтому проецируем включённый `lesson` обратно в легаси-форму.
type EntryWithLesson = {
  lessonId: string | null;
  lesson: { id: string; title: string; assignmentTitle: string | null } | null;
};

function withLegacyAssignmentShape<T extends EntryWithLesson>(entry: T) {
  const { lesson, ...rest } = entry;
  return {
    ...rest,
    lesson,
    // Легаси-алиасы для веба: assignmentId == lessonId, assignment.title из задания урока.
    assignmentId: entry.lessonId,
    assignment: lesson
      ? { id: lesson.id, title: lesson.assignmentTitle ?? lesson.title }
      : null,
  };
}

// Include использовать для всех чтений/записей entry в этом файле.
const ENTRY_INCLUDE = {
  author: { select: { id: true, name: true, role: true } },
  lesson: { select: { id: true, title: true, assignmentTitle: true } },
} as const;

// Short human-readable preview of the latest entry for the inbox list.
function previewForEntry(type: ThreadEntryType, content: string): string {
  switch (type) {
    case 'file':
      return `Файл: ${content}`;
    case 'audio':
      return 'Аудиосообщение';
    case 'link':
      return `Ссылка: ${content}`;
    default:
      return content.length > 140 ? content.slice(0, 140) + '…' : content;
  }
}

export async function threadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /threads — admin inbox: one item per student conversation with activity.
  // Sorted: unanswered (latest entry by student) first, then by lastEntryAt desc.
  app.get('/threads', async (request, reply) => {
    const user = request.user!;
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }

    // Threads of non-deleted students that have at least one entry.
    // Pull the newest entry (author role + preview) per thread, plus the count
    // of unread student-authored entries (readAt null = not yet read by admin).
    const threads = await prisma.conversation.findMany({
      where: {
        type: 'student',
        student: { deletedAt: null },
        entries: { some: {} },
      },
      select: {
        studentId: true,
        student: { select: { name: true } },
        entries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            type: true,
            content: true,
            createdAt: true,
            author: { select: { role: true } },
          },
        },
        _count: {
          select: {
            entries: { where: { readAt: null, author: { role: 'student' } } },
          },
        },
      },
    });

    const summaries = threads
      .filter((t) => t.entries[0])
      .map((t) => {
        const last = t.entries[0]!;
        return {
          studentId: t.studentId!,
          studentName: t.student?.name ?? '',
          lastEntryAt: last.createdAt,
          lastEntryPreview: previewForEntry(last.type, last.content),
          lastEntryAuthorRole: last.author.role,
          unanswered: last.author.role === 'student',
          unreadCount: t._count.entries,
        };
      })
      .sort((a, b) => {
        if (a.unanswered !== b.unanswered) return a.unanswered ? -1 : 1;
        return b.lastEntryAt.getTime() - a.lastEntryAt.getTime();
      });

    return { threads: summaries };
  });

  // GET /threads/:studentId — chronological feed of entries
  // Query params: ?lessonId=X (новый) или ?assignmentId=X (легаси-алиас) — фильтр по
  //   уроку. Веб ещё ходит с ?assignmentId, поэтому принимаем оба и сводим к lessonId.
  app.get('/threads/:studentId', async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
    const query = request.query as { assignmentId?: string; lessonId?: string };
    // assignmentId — легаси-алиас lessonId (assignment свёрнут в блок Lesson).
    const lessonId = query.lessonId ?? query.assignmentId;
    const user = request.user!;

    // Students can only see their own thread
    if (user.role === 'student' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Нет доступа к чужой переписке' });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
      select: { id: true, name: true, email: true },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Студент не найден' });
    }

    // Find or auto-create conversation for student
    let thread = await prisma.conversation.findUnique({
      where: { studentId },
    });

    if (!thread) {
      thread = await prisma.conversation.create({
        data: { studentId, type: 'student' },
      });
    }

    const entries = await prisma.conversationEntry.findMany({
      where: {
        conversationId: thread.id,
        // Students cannot see "note" entries (admin-only notes)
        ...(user.role === 'student' ? { type: { not: 'note' as ThreadEntryType } } : {}),
        // Optional: filter by lesson context (assignment свёрнут в Lesson)
        ...(lessonId ? { lessonId } : {}),
      },
      include: ENTRY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    // Auto-mark entries from the other party as read
    const now = new Date();
    const unreadFromOtherParty = entries
      .filter((e) => e.authorId !== user.userId && !e.readAt)
      .map((e) => e.id);

    if (unreadFromOtherParty.length > 0) {
      await prisma.conversationEntry.updateMany({
        where: { id: { in: unreadFromOtherParty } },
        data: { readAt: now },
      });
      // Update local entries array so response reflects read status
      for (const entry of entries) {
        if (unreadFromOtherParty.includes(entry.id)) {
          (entry as Record<string, unknown>).readAt = now;
        }
      }
    }

    // Generate signed URLs for file/audio entries.
    // withLegacyAssignmentShape добавляет легаси-поля assignmentId/assignment для веба.
    const entriesWithUrls = await Promise.all(
      entries.map(async (entry) => {
        if ((entry.type === 'file' || entry.type === 'audio') && entry.metadata) {
          const meta = entry.metadata as Record<string, unknown>;
          if (meta.s3Key) {
            try {
              const signedUrl = await getFileUrl(meta.s3Key as string);
              return withLegacyAssignmentShape({ ...entry, metadata: { ...meta, url: signedUrl } });
            } catch {
              return withLegacyAssignmentShape(entry);
            }
          }
        }
        return withLegacyAssignmentShape(entry);
      }),
    );

    return { student, thread: { id: thread.id }, entries: entriesWithUrls };
  });

  // PATCH /threads/:studentId/entries/:entryId/read — mark a specific entry as read
  app.patch('/threads/:studentId/entries/:entryId/read', async (request, reply) => {
    const { studentId, entryId } = request.params as { studentId: string; entryId: string };
    const user = request.user!;

    if (user.role === 'student' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Нет доступа к чужой переписке' });
    }

    const entry = await prisma.conversationEntry.findUnique({
      where: { id: entryId },
      include: { conversation: { select: { studentId: true } } },
    });

    if (!entry || entry.conversation.studentId !== studentId) {
      return reply.status(404).send({ error: 'Запись не найдена' });
    }

    // Only recipient can mark as read (not the author)
    if (entry.authorId === user.userId) {
      return reply.status(400).send({ error: 'Нельзя пометить своё сообщение как прочитанное' });
    }

    if (entry.readAt) {
      return { entry: { id: entry.id, readAt: entry.readAt } };
    }

    const updated = await prisma.conversationEntry.update({
      where: { id: entryId },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });

    return { entry: updated };
  });

  // POST /threads/:studentId/entries — add entry (text, file, audio, link, comment, note)
  app.post('/threads/:studentId/entries', async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
    const user = request.user!;

    // Students can only post to their own thread
    if (user.role === 'student' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Нет доступа к чужой переписке' });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
      select: { id: true },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Студент не найден' });
    }

    // Find or auto-create conversation
    let thread = await prisma.conversation.findUnique({ where: { studentId } });
    if (!thread) {
      thread = await prisma.conversation.create({ data: { studentId, type: 'student' } });
    }

    const contentType = request.headers['content-type'] || '';

    // Handle multipart uploads (file, audio)
    if (contentType.includes('multipart/form-data')) {
      return handleMultipartEntry(request, reply, thread.id, user, studentId);
    }

    // Handle JSON entries (text, link, comment, note)
    const body = request.body as {
      type: ThreadEntryType;
      content: string;
      // lessonId — новый FK; assignmentId — легаси-алиас (assignment свёрнут в Lesson).
      assignmentId?: string;
      lessonId?: string;
      metadata?: Record<string, unknown>;
    };
    let lessonId = body.lessonId ?? body.assignmentId ?? null;

    if (!body.type || !body.content) {
      return reply.status(400).send({ error: 'Поля type и content обязательны' });
    }

    if (!ALLOWED_ENTRY_TYPES.includes(body.type)) {
      return reply.status(400).send({ error: `Недопустимый тип записи: ${body.type}` });
    }

    // Check role permissions for entry types
    const allowedTypes = user.role === 'admin' ? ADMIN_ENTRY_TYPES : STUDENT_ENTRY_TYPES;
    if (!allowedTypes.includes(body.type)) {
      return reply.status(403).send({ error: `Тип записи "${body.type}" недоступен для вашей роли` });
    }

    // Резолвим контекст задания (lessonId ИЛИ синтетический sessionId) в реальный lessonId.
    if (lessonId) {
      const resolved = await resolveContextLessonId(lessonId);
      if (!resolved) {
        return reply.status(400).send({ error: 'Задание не найдено' });
      }
      lessonId = resolved;
    }

    const created = await prisma.conversationEntry.create({
      data: {
        conversationId: thread.id,
        authorId: user.userId,
        type: body.type,
        content: body.content,
        lessonId,
        metadata: (body.metadata ?? undefined) as Parameters<typeof prisma.conversationEntry.create>[0]['data']['metadata'],
      },
      include: ENTRY_INCLUDE,
    });
    const entry = withLegacyAssignmentShape(created);

    // Notify the other party: student gets notified when admin posts, admin gets notified when student posts
    if (user.role === 'admin') {
      // Admin wrote in student's thread — notify the student
      createNotification({
        userId: studentId,
        type: 'thread_entry',
        title: 'Новое сообщение от преподавателя',
        body: body.type === 'text' ? body.content.slice(0, 200) : 'Новый файл в переписке',
        metadata: { conversationId: thread.id, entryId: entry.id },
      }).catch(() => {});
    } else {
      // Student wrote — notify the teachers of the student's stream(s) (deduped).
      const recipientIds = await recipientsForStudentThread(studentId);
      const authorName = entry.author.name;
      for (const recipientId of recipientIds) {
        createNotification({
          userId: recipientId,
          type: 'thread_entry',
          title: `Новое сообщение от ${authorName}`,
          body: body.type === 'text' ? body.content.slice(0, 200) : 'Новый файл в переписке',
          metadata: { conversationId: thread.id, entryId: entry.id, studentId },
        }).catch(() => {});
      }
    }

    return reply.status(201).send({ entry });
  });
}

async function handleMultipartEntry(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  conversationId: string,
  user: { userId: string; role: string },
  studentId: string,
): Promise<unknown> {
  const allowedTypes = user.role === 'admin' ? ADMIN_ENTRY_TYPES : STUDENT_ENTRY_TYPES;

  const parts = request.parts();
  let fileBuffer: Buffer | null = null;
  let fileName = '';
  let fileMimeType = '';
  let entryType: ThreadEntryType = 'file';
  // lessonId — новый FK; поле assignmentId (легаси веба) принимаем как его алиас.
  let lessonId: string | null = null;

  for await (const part of parts) {
    if (part.type === 'file') {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      fileBuffer = Buffer.concat(chunks);
      fileName = part.filename;
      fileMimeType = part.mimetype;
    } else {
      const value = part.value as string;
      if (part.fieldname === 'type') {
        entryType = value as ThreadEntryType;
      } else if (part.fieldname === 'lessonId' || part.fieldname === 'assignmentId') {
        lessonId = value || null;
      }
    }
  }

  if (!fileBuffer || !fileName) {
    return reply.status(400).send({ error: 'Файл обязателен для загрузки' });
  }

  if (!['file', 'audio'].includes(entryType)) {
    entryType = 'file';
  }

  if (!allowedTypes.includes(entryType)) {
    return reply.status(403).send({ error: `Тип записи "${entryType}" недоступен для вашей роли` });
  }

  if (lessonId) {
    const resolved = await resolveContextLessonId(lessonId);
    if (!resolved) {
      return reply.status(400).send({ error: 'Задание не найдено' });
    }
    lessonId = resolved;
  }

  const uploaded = await uploadFile(fileBuffer, fileName, fileMimeType);

  const created = await prisma.conversationEntry.create({
    data: {
      conversationId,
      authorId: user.userId,
      type: entryType,
      content: fileName,
      metadata: {
        s3Key: uploaded.key,
        fileName,
        mimeType: fileMimeType,
        size: uploaded.size,
      },
      lessonId,
    },
    include: ENTRY_INCLUDE,
  });
  const entry = withLegacyAssignmentShape(created);

  // Notify the other party for file uploads too
  if (user.role === 'admin') {
    createNotification({
      userId: studentId,
      type: 'thread_entry',
      title: 'Новый файл от преподавателя',
      body: `Загружен файл: ${fileName}`,
      metadata: { conversationId, entryId: entry.id },
    }).catch(() => {});
  } else {
    // Student uploaded — notify the teachers of the student's stream(s) (deduped).
    const recipientIds = await recipientsForStudentThread(studentId);
    for (const recipientId of recipientIds) {
      createNotification({
        userId: recipientId,
        type: 'thread_entry',
        title: `Новый файл от ${entry.author.name}`,
        body: `Загружен файл: ${fileName}`,
        metadata: { conversationId, entryId: entry.id, studentId },
      }).catch(() => {});
    }
  }

  return reply.status(201).send({ entry });
}
