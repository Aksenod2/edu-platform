import type { FastifyInstance } from 'fastify';
import { prisma, type ThreadEntryType } from '@platform/db';
import { authenticate } from '../middleware/auth.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { createNotification } from '../lib/notifications.js';

const ALLOWED_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link', 'comment', 'note'];
const STUDENT_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link'];
const ADMIN_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link', 'comment', 'note'];

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
  // Query params: ?assignmentId=X to filter by assignment context
  app.get('/threads/:studentId', async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
    const { assignmentId } = request.query as { assignmentId?: string };
    const user = request.user!;

    // Students can only see their own thread
    if (user.role === 'student' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Нет доступа к чужому треду' });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
      select: { id: true, name: true, email: true },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Ученик не найден' });
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
        // Optional: filter by assignment context
        ...(assignmentId ? { assignmentId } : {}),
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
        assignment: { select: { id: true, title: true } },
      },
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

    // Generate signed URLs for file/audio entries
    const entriesWithUrls = await Promise.all(
      entries.map(async (entry) => {
        if ((entry.type === 'file' || entry.type === 'audio') && entry.metadata) {
          const meta = entry.metadata as Record<string, unknown>;
          if (meta.s3Key) {
            try {
              const signedUrl = await getFileUrl(meta.s3Key as string);
              return { ...entry, metadata: { ...meta, url: signedUrl } };
            } catch {
              return entry;
            }
          }
        }
        return entry;
      }),
    );

    return { student, thread: { id: thread.id }, entries: entriesWithUrls };
  });

  // PATCH /threads/:studentId/entries/:entryId/read — mark a specific entry as read
  app.patch('/threads/:studentId/entries/:entryId/read', async (request, reply) => {
    const { studentId, entryId } = request.params as { studentId: string; entryId: string };
    const user = request.user!;

    if (user.role === 'student' && user.userId !== studentId) {
      return reply.status(403).send({ error: 'Нет доступа к чужому треду' });
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
      return reply.status(403).send({ error: 'Нет доступа к чужому треду' });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'student' },
      select: { id: true },
    });

    if (!student) {
      return reply.status(404).send({ error: 'Ученик не найден' });
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
      assignmentId?: string;
      metadata?: Record<string, unknown>;
    };

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

    // Validate assignmentId if provided
    if (body.assignmentId) {
      const assignment = await prisma.assignment.findUnique({
        where: { id: body.assignmentId },
        select: { id: true },
      });
      if (!assignment) {
        return reply.status(400).send({ error: 'Задание не найдено' });
      }
    }

    const entry = await prisma.conversationEntry.create({
      data: {
        conversationId: thread.id,
        authorId: user.userId,
        type: body.type,
        content: body.content,
        assignmentId: body.assignmentId || null,
        metadata: (body.metadata ?? undefined) as Parameters<typeof prisma.conversationEntry.create>[0]['data']['metadata'],
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
        assignment: { select: { id: true, title: true } },
      },
    });

    // Notify the other party: student gets notified when admin posts, admin gets notified when student posts
    if (user.role === 'admin') {
      // Admin wrote in student's thread — notify the student
      createNotification({
        userId: studentId,
        type: 'thread_entry',
        title: 'Новое сообщение от преподавателя',
        body: body.type === 'text' ? body.content.slice(0, 200) : 'Новый файл в треде',
        metadata: { conversationId: thread.id, entryId: entry.id },
      }).catch(() => {});
    } else {
      // Student wrote — notify all admins
      const admins = await prisma.user.findMany({
        where: { role: 'admin', isActive: true, deletedAt: null },
        select: { id: true, name: true },
      });
      const authorName = entry.author.name;
      for (const admin of admins) {
        createNotification({
          userId: admin.id,
          type: 'thread_entry',
          title: `Новое сообщение от ${authorName}`,
          body: body.type === 'text' ? body.content.slice(0, 200) : 'Новый файл в треде',
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
  let assignmentId: string | null = null;

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
      } else if (part.fieldname === 'assignmentId') {
        assignmentId = value || null;
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

  if (assignmentId) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true },
    });
    if (!assignment) {
      return reply.status(400).send({ error: 'Задание не найдено' });
    }
  }

  const uploaded = await uploadFile(fileBuffer, fileName, fileMimeType);

  const entry = await prisma.conversationEntry.create({
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
      assignmentId,
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
      assignment: { select: { id: true, title: true } },
    },
  });

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
    const admins = await prisma.user.findMany({
      where: { role: 'admin', isActive: true, deletedAt: null },
      select: { id: true },
    });
    for (const admin of admins) {
      createNotification({
        userId: admin.id,
        type: 'thread_entry',
        title: `Новый файл от ${entry.author.name}`,
        body: `Загружен файл: ${fileName}`,
        metadata: { conversationId, entryId: entry.id, studentId },
      }).catch(() => {});
    }
  }

  return reply.status(201).send({ entry });
}
