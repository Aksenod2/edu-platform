import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { prisma, type ThreadEntryType } from '@platform/db';
import { authenticate } from '../middleware/auth.js';
import { uploadFile, getFileUrl, MAX_FILE_SIZE } from '../lib/s3.js';

const ALLOWED_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link', 'comment', 'note'];
const STUDENT_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link'];
const ADMIN_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link', 'comment', 'note'];

export async function threadRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });
  app.addHook('preHandler', authenticate);

  // GET /threads/:studentId — chronological feed of entries
  app.get('/threads/:studentId', async (request, reply) => {
    const { studentId } = request.params as { studentId: string };
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

    // Find or auto-create thread for student
    let thread = await prisma.thread.findUnique({
      where: { studentId },
    });

    if (!thread) {
      thread = await prisma.thread.create({
        data: { studentId },
      });
    }

    const entries = await prisma.threadEntry.findMany({
      where: {
        threadId: thread.id,
        // Students cannot see "note" entries (admin-only notes)
        ...(user.role === 'student' ? { type: { not: 'note' as ThreadEntryType } } : {}),
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
        assignment: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

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

    // Find or auto-create thread
    let thread = await prisma.thread.findUnique({ where: { studentId } });
    if (!thread) {
      thread = await prisma.thread.create({ data: { studentId } });
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

    const entry = await prisma.threadEntry.create({
      data: {
        threadId: thread.id,
        authorId: user.userId,
        type: body.type,
        content: body.content,
        assignmentId: body.assignmentId || null,
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
        assignment: { select: { id: true, title: true } },
      },
    });

    return reply.status(201).send({ entry });
  });
}

async function handleMultipartEntry(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  threadId: string,
  user: { userId: string; role: string },
  studentId: string,
) {
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

  const entry = await prisma.threadEntry.create({
    data: {
      threadId,
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

  return reply.status(201).send({ entry });
}
