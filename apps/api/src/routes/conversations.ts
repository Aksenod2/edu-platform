import type { FastifyInstance } from 'fastify';
import { prisma, type ThreadEntryType, Prisma } from '@platform/db';
import { requireRole } from '../middleware/auth.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { notifyMany } from '../lib/notifications.js';

// Типы записей, доступные в штаб-канале: текст, файл, аудио, ссылка.
// «comment»/«note» — специфика студенческого треда, в штабе не используются.
const STAFF_ENTRY_TYPES: ThreadEntryType[] = ['text', 'file', 'audio', 'link'];

/**
 * Найти единый штаб-канал преподавателей (Conversation type='staff').
 * Создаётся миграцией; если по какой-то причине отсутствует — создаём.
 */
async function getOrCreateStaffConversation() {
  const existing = await prisma.conversation.findFirst({ where: { type: 'staff' } });
  if (existing) return existing;
  return prisma.conversation.create({ data: { type: 'staff' } });
}

/**
 * Подсчёт непрочитанного для пользователя в данном канале:
 * число записей с createdAt > lastReadAt И автором не он сам.
 * Если отметки прочтения ещё нет — считаем все чужие записи непрочитанными.
 */
async function countStaffUnread(conversationId: string, userId: string): Promise<number> {
  const read = await prisma.conversationRead.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  return prisma.conversationEntry.count({
    where: {
      conversationId,
      authorId: { not: userId },
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}

export async function conversationRoutes(app: FastifyInstance) {
  // Весь штаб-канал доступен ТОЛЬКО админам. Студенты не имеют доступа к API.
  app.addHook('preHandler', requireRole('admin'));

  // GET /conversations/staff — лента штаба + текущий счётчик непрочитанного.
  // Порядок важен: unreadCount считаем ДО upsert lastReadAt, иначе всегда 0.
  app.get('/conversations/staff', async (request) => {
    const user = request.user!;
    const conversation = await getOrCreateStaffConversation();

    const entries = await prisma.conversationEntry.findMany({
      where: { conversationId: conversation.id },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Счётчик непрочитанного по СТАРОЙ отметке прочтения (до апдейта).
    const unreadCount = await countStaffUnread(conversation.id, user.userId);

    // Подписанные URL для файлов/аудио.
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

    // Открытие ленты = прочтение: обновляем отметку текущего пользователя.
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: user.userId } },
      create: { conversationId: conversation.id, userId: user.userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });

    return { conversation: { id: conversation.id }, entries: entriesWithUrls, unreadCount };
  });

  // GET /conversations/staff/unread — лёгкий счётчик непрочитанного для бейджа
  // на вкладке (без открытия ленты, не сбрасывает отметку прочтения).
  app.get('/conversations/staff/unread', async (request) => {
    const user = request.user!;
    const conversation = await getOrCreateStaffConversation();
    const unreadCount = await countStaffUnread(conversation.id, user.userId);
    return { unreadCount };
  });

  // POST /conversations/staff/entries — добавить запись (text, link — JSON; file, audio — multipart).
  app.post('/conversations/staff/entries', async (request, reply) => {
    const user = request.user!;
    const conversation = await getOrCreateStaffConversation();

    const contentType = request.headers['content-type'] || '';

    // Файлы/аудио — через multipart.
    if (contentType.includes('multipart/form-data')) {
      return handleStaffMultipartEntry(request, reply, conversation.id, user);
    }

    // JSON: text / link.
    const body = request.body as {
      type: ThreadEntryType;
      content: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.type || !body.content) {
      return reply.status(400).send({ error: 'Поля type и content обязательны' });
    }

    if (!STAFF_ENTRY_TYPES.includes(body.type)) {
      return reply.status(400).send({ error: `Недопустимый тип записи: ${body.type}` });
    }

    const entry = await prisma.conversationEntry.create({
      data: {
        conversationId: conversation.id,
        authorId: user.userId,
        type: body.type,
        content: body.content,
        metadata: body.metadata
          ? (body.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
    });

    await notifyStaff(conversation.id, entry.id, user.userId, entry.author.name, body.type, body.content);

    return reply.status(201).send({ entry });
  });
}

/**
 * Уведомить всех активных админов, кроме автора, о новом сообщении в штабе.
 */
async function notifyStaff(
  conversationId: string,
  entryId: string,
  authorId: string,
  authorName: string,
  type: ThreadEntryType,
  content: string,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true, deletedAt: null, id: { not: authorId } },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const body =
    type === 'text'
      ? content.slice(0, 200)
      : type === 'link'
        ? 'Новая ссылка в штабе'
        : 'Новый файл в штабе';

  await notifyMany(
    admins.map((a) => a.id),
    'thread_entry',
    `Новое сообщение в штабе от ${authorName}`,
    body,
    { conversationId, entryId },
  );
}

async function handleStaffMultipartEntry(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  conversationId: string,
  user: { userId: string; role: string },
): Promise<unknown> {
  const parts = request.parts();
  let fileBuffer: Buffer | null = null;
  let fileName = '';
  let fileMimeType = '';
  let entryType: ThreadEntryType = 'file';

  for await (const part of parts) {
    if (part.type === 'file') {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      fileBuffer = Buffer.concat(chunks);
      fileName = part.filename;
      fileMimeType = part.mimetype;
    } else if (part.fieldname === 'type') {
      entryType = part.value as ThreadEntryType;
    }
  }

  if (!fileBuffer || !fileName) {
    return reply.status(400).send({ error: 'Файл обязателен для загрузки' });
  }

  if (!['file', 'audio'].includes(entryType)) {
    entryType = 'file';
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
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
    },
  });

  await notifyStaff(conversationId, entry.id, user.userId, entry.author.name, entryType, fileName);

  return reply.status(201).send({ entry });
}
