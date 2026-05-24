import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma, type ThreadEntryType, Prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { isEnrolled } from '../lib/enrollment.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { notifyMany } from '../lib/notifications.js';
import {
  deriveStreamTeachers,
  getStreamTeacherList,
  streamTeacherSourcesInclude,
} from '../lib/stream-teachers.js';

// Типы записей, доступные в каналах преподавателей (штаб, поток): текст, файл, аудио, ссылка.
// «comment»/«note» — специфика студенческого треда, здесь не используются.
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
 * Найти пер-поточный канал преподавателей (Conversation type='stream', streamId).
 * Создаётся лениво при первом обращении (streamId @unique).
 */
async function getOrCreateStreamConversation(streamId: string) {
  const existing = await prisma.conversation.findFirst({ where: { type: 'stream', streamId } });
  if (existing) return existing;
  return prisma.conversation.create({ data: { type: 'stream', streamId } });
}

/**
 * Найти общий чат потока (Conversation type='cohort', streamId), где участвуют
 * ВСЕ студенты потока + преподаватели. Создаётся лениво при первом обращении.
 */
async function getOrCreateCohortConversation(streamId: string) {
  const existing = await prisma.conversation.findFirst({ where: { type: 'cohort', streamId } });
  if (existing) return existing;
  return prisma.conversation.create({ data: { type: 'cohort', streamId } });
}

/**
 * Преподаватели потока — уникальные admin'ы по урокам потока (из LessonTeacher).
 * Источник уроков перенесён в lib/stream-teachers.ts: программные потоки —
 * через program.programLessons, менторские — через sessions.lesson.
 * «Общий» поток (shared) — тот, где преподаёт больше одного преподавателя.
 */
async function getStreamTeachers(streamId: string): Promise<string[]> {
  const teachers = await getStreamTeacherList(streamId);
  return teachers.map((t) => t.id);
}

/**
 * «Общий» ли поток (>1 преподавателя по урокам). Возвращает также список
 * id преподавателей, чтобы не запрашивать их повторно.
 */
async function getStreamShared(
  streamId: string,
): Promise<{ shared: boolean; teacherIds: string[] }> {
  const teacherIds = await getStreamTeachers(streamId);
  return { shared: teacherIds.length > 1, teacherIds };
}

/**
 * Подсчёт непрочитанного для пользователя в данном канале:
 * число записей с createdAt > lastReadAt И автором не он сам.
 * Если отметки прочтения ещё нет — считаем все чужие записи непрочитанными.
 */
async function countUnread(conversationId: string, userId: string): Promise<number> {
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

/**
 * Суммарное непрочитанное в cohort-чатах пользователя ОДНИМ запросом, без
 * ленивого создания Conversation в цикле. Для каждого cohort-канала «непрочитано» =
 * число чужих записей с createdAt > lastReadAt текущего пользователя (если отметки
 * прочтения ещё нет — считаются все чужие записи). Считаем агрегатом по записям:
 * groupBy по conversationId среди cohort-каналов нужных потоков, затем для каждого
 * сверяем с lastReadAt из ConversationRead. Если cohort-канал ещё не создан —
 * непрочитанного в нём заведомо нет (создаём лениво лишь при открытии ленты).
 */
async function countCohortsUnread(userId: string, streamIds: string[]): Promise<number> {
  if (streamIds.length === 0) return 0;

  // Cohort-каналы только тех потоков, что нужны (для студента — его enrollments,
  // для админа — все). Каналы, которых ещё нет в БД, в выборку не попадут (0).
  const conversations = await prisma.conversation.findMany({
    where: { type: 'cohort', streamId: { in: streamIds } },
    select: { id: true },
  });
  if (conversations.length === 0) return 0;
  const conversationIds = conversations.map((c) => c.id);

  // Отметки прочтения пользователя по этим каналам — одним запросом.
  const reads = await prisma.conversationRead.findMany({
    where: { userId, conversationId: { in: conversationIds } },
    select: { conversationId: true, lastReadAt: true },
  });
  const lastReadByConversation = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

  // Параллельные count'ы по каналам: чужие записи новее отметки прочтения.
  // Запросов = число cohort-каналов пользователя (обычно единицы), без выборки лент.
  const counts = await Promise.all(
    conversationIds.map((conversationId) => {
      const lastReadAt = lastReadByConversation.get(conversationId);
      return prisma.conversationEntry.count({
        where: {
          conversationId,
          authorId: { not: userId },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      });
    }),
  );

  return counts.reduce((sum, n) => sum + n, 0);
}

export async function conversationRoutes(app: FastifyInstance) {
  // Гард для staff/stream-каналов: ТОЛЬКО админы (преподаватели).
  // Студенты не имеют доступа к этим каналам ни на чтение, ни на запись.
  const adminOnly = requireRole('admin');

  // GET /messages/unread-count — лёгкий суммарный счётчик непрочитанных входящих во
  // ВСЕХ каналах сообщений текущего пользователя (для бейджа в сайдбаре). Роль-зависимый,
  // считает ТОЛЬКО «своё», БЕЗ выборки лент и БЕЗ пометки прочитанным. Контракт ответа
  // намеренно минимален: { unreadCount: number }.
  //
  // АДМИН (суммируем 3 канала):
  //   (а) все личные треды со студентами — входящие от студентов с readAt=null
  //       (та же механика, что в GET /threads, но только count);
  //   (б) штаб-канал персонала — как GET /conversations/staff/unread;
  //   (в) все cohort-чаты потоков — сумма непрочитанного по ConversationRead.
  //
  // СТУДЕНТ (суммируем 2 канала, чужого НЕ видит):
  //   (а) ЕГО личный тред с преподавателем — входящие от admin/staff с readAt=null
  //       (БЕЗ пометки прочитанным, в отличие от GET /threads/:studentId);
  //   (б) его cohort-чаты по его enrollments.
  app.get('/messages/unread-count', { onRequest: authenticate }, async (request) => {
    const user = request.user!;

    if (user.role === 'admin') {
      const [personalUnread, staffConversation, allStreams] = await Promise.all([
        // (а) Личные треды: входящие от студентов, ещё не прочитанные админом.
        // Один count по всем student-каналам сразу (без разбивки по студентам).
        prisma.conversationEntry.count({
          where: {
            conversation: { type: 'student' },
            author: { role: 'student' },
            authorId: { not: user.userId },
            readAt: null,
          },
        }),
        // (б) Штаб-канал (создаём лениво, как и остальные хендлеры штаба).
        getOrCreateStaffConversation(),
        // Потоки для cohort-чатов: админу — все.
        prisma.stream.findMany({ select: { id: true } }),
      ]);

      const [staffUnread, cohortsUnread] = await Promise.all([
        countUnread(staffConversation.id, user.userId),
        countCohortsUnread(user.userId, allStreams.map((s) => s.id)),
      ]);

      return { unreadCount: personalUnread + staffUnread + cohortsUnread };
    }

    // Студент: только ЕГО личный тред + ЕГО cohort-чаты.
    const [personalUnread, enrollments] = await Promise.all([
      // (а) Входящие в собственном треде от не-студентов (admin/staff), не прочитанные.
      // Фильтр conversation.studentId = me гарантирует приватность (только свой тред).
      prisma.conversationEntry.count({
        where: {
          conversation: { type: 'student', studentId: user.userId },
          author: { role: { not: 'student' } },
          authorId: { not: user.userId },
          readAt: null,
        },
      }),
      // (б) Потоки студента — только его зачисления.
      prisma.streamEnrollment.findMany({
        where: { userId: user.userId },
        select: { streamId: true },
      }),
    ]);

    const cohortsUnread = await countCohortsUnread(
      user.userId,
      enrollments.map((e) => e.streamId),
    );

    return { unreadCount: personalUnread + cohortsUnread };
  });

  // GET /conversations/staff — лента штаба + текущий счётчик непрочитанного.
  // Порядок важен: unreadCount считаем ДО upsert lastReadAt, иначе всегда 0.
  app.get('/conversations/staff', { onRequest: adminOnly }, async (request) => {
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
    const unreadCount = await countUnread(conversation.id, user.userId);

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
  app.get('/conversations/staff/unread', { onRequest: adminOnly }, async (request) => {
    const user = request.user!;
    const conversation = await getOrCreateStaffConversation();
    const unreadCount = await countUnread(conversation.id, user.userId);
    return { unreadCount };
  });

  // POST /conversations/staff/entries — добавить запись (text, link — JSON; file, audio — multipart).
  app.post('/conversations/staff/entries', { onRequest: adminOnly }, async (request, reply) => {
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

    // Уведомления — fire-and-forget: сбой рассылки не должен валить POST,
    // запись уже создана (иначе админ пере-отправит → дубль).
    notifyStaff(conversation.id, entry.id, user.userId, entry.author.name, body.type, body.content).catch(
      () => {},
    );

    return reply.status(201).send({ entry });
  });

  // ─── Пер-поточные каналы (Conversation type='stream') ──────────────────────
  // Чат преподавателей внутри одного «общего» потока (>1 преподавателя).

  // GET /conversations/streams — список «общих» потоков со счётчиком непрочитанного
  // для текущего пользователя (для вкладки «Потоки»). Каналы создаём лениво.
  app.get('/conversations/streams', { onRequest: adminOnly }, async (request) => {
    const user = request.user!;

    // Все потоки с преподавателями по урокам (program + sessions) —
    // вычисляем «общие» в памяти через общий хелпер deriveStreamTeachers.
    const streams = await prisma.stream.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        ...streamTeacherSourcesInclude,
      },
      orderBy: { createdAt: 'desc' },
    });

    const shared = streams.filter((s) => deriveStreamTeachers(s).shared);

    const result = await Promise.all(
      shared.map(async (s) => {
        const conversation = await getOrCreateStreamConversation(s.id);
        const unreadCount = await countUnread(conversation.id, user.userId);
        return { streamId: s.id, name: s.name, status: s.status, unreadCount };
      }),
    );

    return { streams: result };
  });

  // GET /conversations/stream/:streamId — лента потока + счётчик непрочитанного.
  // Доступно только для «общих» потоков; порядок важен: unreadCount считаем ДО upsert.
  app.get('/conversations/stream/:streamId', { onRequest: adminOnly }, async (request, reply) => {
    const user = request.user!;
    const { streamId } = request.params as { streamId: string };

    const stream = await prisma.stream.findUnique({ where: { id: streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    const { shared } = await getStreamShared(streamId);
    if (!shared) {
      return reply.status(400).send({ error: 'Чат доступен только для общих групп' });
    }

    const conversation = await getOrCreateStreamConversation(streamId);

    const entries = await prisma.conversationEntry.findMany({
      where: { conversationId: conversation.id },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Счётчик непрочитанного по СТАРОЙ отметке прочтения (до апдейта).
    const unreadCount = await countUnread(conversation.id, user.userId);

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

    return {
      conversation: { id: conversation.id, streamId },
      entries: entriesWithUrls,
      unreadCount,
    };
  });

  // POST /conversations/stream/:streamId/entries — добавить запись
  // (text, link — JSON; file, audio — multipart).
  app.post('/conversations/stream/:streamId/entries', { onRequest: adminOnly }, async (request, reply) => {
    const user = request.user!;
    const { streamId } = request.params as { streamId: string };

    const stream = await prisma.stream.findUnique({ where: { id: streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    const { shared, teacherIds } = await getStreamShared(streamId);
    if (!shared) {
      return reply.status(400).send({ error: 'Чат доступен только для общих групп' });
    }

    const conversation = await getOrCreateStreamConversation(streamId);

    const contentType = request.headers['content-type'] || '';

    // Файлы/аудио — через multipart.
    if (contentType.includes('multipart/form-data')) {
      return handleStreamMultipartEntry(request, reply, conversation.id, streamId, teacherIds, user);
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

    // Уведомления — fire-and-forget: сбой рассылки не должен валить POST,
    // запись уже создана (иначе автор пере-отправит → дубль).
    notifyStream(
      conversation.id,
      entry.id,
      streamId,
      stream.name,
      teacherIds,
      user.userId,
      entry.author.name,
      body.type,
      body.content,
    ).catch(() => {});

    return reply.status(201).send({ entry });
  });

  // ─── Общий чат потока (Conversation type='cohort') ─────────────────────────
  // Открыт ВСЕМ участникам потока: зачисленным студентам + преподавателям + админам.
  // Доступ: admin ИЛИ зачисленный студент потока; иначе 403. Без модерации.

  /**
   * Проверка доступа к общему чату потока. Возвращает true, если пользователь —
   * админ ИЛИ зачислён в поток. Студенты вне потока доступа не имеют.
   */
  async function canAccessCohort(
    request: FastifyRequest,
    reply: FastifyReply,
    streamId: string,
  ): Promise<boolean> {
    const user = request.user!;
    if (user.role === 'admin') return true;
    const enrolled = await isEnrolled(user.userId, streamId);
    if (enrolled) return true;
    reply.status(403).send({ error: 'Нет доступа к чату этой группы' });
    return false;
  }

  // GET /conversations/cohorts — список общих чатов для текущего пользователя:
  // студенту — его зачисленные потоки; админу — все потоки. Со счётчиком непрочитанного.
  app.get('/conversations/cohorts', { onRequest: authenticate }, async (request) => {
    const user = request.user!;
    const isAdmin = user.role === 'admin';

    const streams = await prisma.stream.findMany({
      where: isAdmin ? {} : { enrollments: { some: { userId: user.userId } } },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: 'desc' },
    });

    const result = await Promise.all(
      streams.map(async (s) => {
        const conversation = await getOrCreateCohortConversation(s.id);
        const unreadCount = await countUnread(conversation.id, user.userId);
        return { streamId: s.id, name: s.name, status: s.status, unreadCount };
      }),
    );

    return { streams: result };
  });

  // GET /conversations/cohort/:streamId — лента общего чата потока + счётчик непрочитанного.
  // Порядок важен: unreadCount считаем ДО upsert lastReadAt.
  app.get('/conversations/cohort/:streamId', { onRequest: authenticate }, async (request, reply) => {
    const user = request.user!;
    const { streamId } = request.params as { streamId: string };

    const stream = await prisma.stream.findUnique({ where: { id: streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Группа не найдена' });
    }

    if (!(await canAccessCohort(request, reply, streamId))) return reply;

    const conversation = await getOrCreateCohortConversation(streamId);

    const entries = await prisma.conversationEntry.findMany({
      where: { conversationId: conversation.id },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Счётчик непрочитанного по СТАРОЙ отметке прочтения (до апдейта).
    const unreadCount = await countUnread(conversation.id, user.userId);

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

    return {
      conversation: { id: conversation.id, streamId },
      entries: entriesWithUrls,
      unreadCount,
    };
  });

  // POST /conversations/cohort/:streamId/entries — добавить запись
  // (text, link — JSON; file, audio — multipart).
  app.post(
    '/conversations/cohort/:streamId/entries',
    { onRequest: authenticate },
    async (request, reply) => {
      const user = request.user!;
      const { streamId } = request.params as { streamId: string };

      const stream = await prisma.stream.findUnique({ where: { id: streamId } });
      if (!stream) {
        return reply.status(404).send({ error: 'Группа не найдена' });
      }

      if (!(await canAccessCohort(request, reply, streamId))) return reply;

      const conversation = await getOrCreateCohortConversation(streamId);

      const contentType = request.headers['content-type'] || '';

      // Файлы/аудио — через multipart.
      if (contentType.includes('multipart/form-data')) {
        return handleCohortMultipartEntry(request, reply, conversation.id, streamId, user);
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

      // Уведомления — fire-and-forget: сбой рассылки не должен валить POST,
      // запись уже создана (иначе автор пере-отправит → дубль).
      notifyCohort(
        conversation.id,
        entry.id,
        streamId,
        stream.name,
        user.userId,
        entry.author.name,
        body.type,
        body.content,
      ).catch(() => {});

      return reply.status(201).send({ entry });
    },
  );
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

  notifyStaff(conversationId, entry.id, user.userId, entry.author.name, entryType, fileName).catch(
    () => {},
  );

  return reply.status(201).send({ entry });
}

/**
 * Уведомить аудиторию пер-поточного канала о новом сообщении:
 * преподаватели потока + все активные админы, КРОМЕ автора (с дедупликацией).
 * Ссылка ведёт в /admin/messages (studentId не задаём — это канал преподавателей).
 */
async function notifyStream(
  conversationId: string,
  entryId: string,
  streamId: string,
  streamName: string,
  teacherIds: string[],
  authorId: string,
  authorName: string,
  type: ThreadEntryType,
  content: string,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true, deletedAt: null },
    select: { id: true },
  });

  // Аудитория = преподаватели потока ∪ активные админы, минус автор (dedupe через Set).
  const recipients = new Set<string>([...teacherIds, ...admins.map((a) => a.id)]);
  recipients.delete(authorId);
  if (recipients.size === 0) return;

  const body =
    type === 'text'
      ? content.slice(0, 200)
      : type === 'link'
        ? `Новая ссылка в группе «${streamName}»`
        : `Новый файл в группе «${streamName}»`;

  await notifyMany(
    [...recipients],
    'thread_entry',
    `Новое сообщение в группе «${streamName}» от ${authorName}`,
    body,
    { conversationId, entryId, streamId },
  );
}

async function handleStreamMultipartEntry(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  conversationId: string,
  streamId: string,
  teacherIds: string[],
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

  // Имя потока нужно для текста уведомления; берём из БД (канал уже подтверждён «общим»).
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { name: true },
  });

  notifyStream(
    conversationId,
    entry.id,
    streamId,
    stream?.name ?? '',
    teacherIds,
    user.userId,
    entry.author.name,
    entryType,
    fileName,
  ).catch(() => {});

  return reply.status(201).send({ entry });
}

/**
 * Уведомить аудиторию общего чата потока о новом сообщении:
 * зачисленные студенты потока + преподаватели потока + активные админы,
 * КРОМЕ автора (с дедупликацией). Ссылка несёт streamId для навигации.
 */
async function notifyCohort(
  conversationId: string,
  entryId: string,
  streamId: string,
  streamName: string,
  authorId: string,
  authorName: string,
  type: ThreadEntryType,
  content: string,
): Promise<void> {
  const [enrollments, teacherIds, admins] = await Promise.all([
    prisma.streamEnrollment.findMany({
      where: { streamId, user: { isActive: true, deletedAt: null } },
      select: { userId: true },
    }),
    getStreamTeachers(streamId),
    prisma.user.findMany({
      where: { role: 'admin', isActive: true, deletedAt: null },
      select: { id: true },
    }),
  ]);

  // Аудитория = студенты потока ∪ преподаватели потока ∪ админы, минус автор.
  const recipients = new Set<string>([
    ...enrollments.map((e) => e.userId),
    ...teacherIds,
    ...admins.map((a) => a.id),
  ]);
  recipients.delete(authorId);
  if (recipients.size === 0) return;

  const body =
    type === 'text'
      ? content.slice(0, 200)
      : type === 'link'
        ? `Новая ссылка в чате группы «${streamName}»`
        : `Новый файл в чате группы «${streamName}»`;

  await notifyMany(
    [...recipients],
    'thread_entry',
    `Новое сообщение в чате группы «${streamName}» от ${authorName}`,
    body,
    { conversationId, entryId, streamId },
  );
}

async function handleCohortMultipartEntry(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  conversationId: string,
  streamId: string,
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

  // Имя потока нужно для текста уведомления.
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { name: true },
  });

  notifyCohort(
    conversationId,
    entry.id,
    streamId,
    stream?.name ?? '',
    user.userId,
    entry.author.name,
    entryType,
    fileName,
  ).catch(() => {});

  return reply.status(201).send({ entry });
}
