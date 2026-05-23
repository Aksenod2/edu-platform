import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { createNotification, notifyMany } from '../lib/notifications.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

// ─── Projection shim ────────────────────────────────────────────────────────
//
// Модель данных переехала: отдельной сущности Assignment больше НЕТ. Задание
// «свёрнуто» в БЛОК урока (Lesson): hasAssignment / assignmentTitle /
// assignmentDescription / assignmentCriteria / assignmentType / assignmentTags /
// assignmentMaterials. Пер-поточный дедлайн живёт на Session.dueDate
// (Session = streamId × lessonId). StudentAssignment теперь ссылается на Session.
//
// Чтобы фронт продолжал работать без изменений, мы синтезируем «задание» из пары
// (Session, его Lesson): СИНТЕТИЧЕСКИЙ id задания = sessionId. Так дедлайн и
// сдачи разрешаются пер-поток. Форма ответа полностью совпадает со старой
// сущностью Assignment, которую читает веб.

export interface AssignmentMaterial {
  type: 'file' | 'url';
  name: string;
  url: string;
  size?: number;
  s3Key?: string;
}

async function regenerateMaterialUrls(materials: AssignmentMaterial[]): Promise<AssignmentMaterial[]> {
  return Promise.all(
    materials.map(async (m) => {
      if (m.type === 'file' && m.s3Key) {
        try {
          const signedUrl = await getFileUrl(m.s3Key);
          return { ...m, url: signedUrl };
        } catch {
          return m;
        }
      }
      return m;
    }),
  );
}

// Минимальный блок урока (folded assignment*-поля), нужный для проекции задания.
type LessonAssignmentBlock = {
  id: string;
  title: string;
  hasAssignment: boolean;
  assignmentTitle: string | null;
  assignmentDescription: string | null;
  assignmentCriteria: string | null;
  assignmentType: 'short' | 'long' | null;
  assignmentTags: string[];
  assignmentMaterials: unknown;
};

// Session с подгруженным блоком урока (+ опционально поток и счётчик сдач).
type SessionWithLesson = {
  id: string;
  streamId: string;
  lessonId: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lesson: LessonAssignmentBlock;
  stream?: { id: string; name: string };
  _count?: { studentAssignments: number };
};

// Поля Session, нужные для проекции синтетического задания.
const sessionAssignmentSelect = {
  id: true,
  streamId: true,
  lessonId: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  lesson: {
    select: {
      id: true,
      title: true,
      hasAssignment: true,
      assignmentTitle: true,
      assignmentDescription: true,
      assignmentCriteria: true,
      assignmentType: true,
      assignmentTags: true,
      assignmentMaterials: true,
    },
  },
} as const;

// Поля блока урока, относящиеся к заданию (для апдейтов через assignment*).
const lessonAssignmentSelect = {
  id: true,
  title: true,
  hasAssignment: true,
  assignmentTitle: true,
  assignmentDescription: true,
  assignmentCriteria: true,
  assignmentType: true,
  assignmentTags: true,
  assignmentMaterials: true,
} as const;

// Проецирует пару (Session, его блок урока) в СТАРУЮ форму Assignment, которую
// читает веб. Синтетический id задания = sessionId. materials НЕ ре-подписаны
// (это делает вызывающий, т.к. операция асинхронная).
function projectAssignment(session: SessionWithLesson): {
  id: string;
  streamId: string;
  lessonId: string;
  title: string;
  description: string | null;
  criteria: string | null;
  type: 'short' | 'long';
  tags: string[];
  dueDate: Date | null;
  groupId: null;
  materials: unknown;
  lesson: { id: string; title: string };
  stream?: { id: string; name: string };
  _count?: { studentAssignments: number };
  createdAt: Date;
  updatedAt: Date;
} {
  const l = session.lesson;
  return {
    id: session.id,
    streamId: session.streamId,
    lessonId: session.lessonId,
    title: l.assignmentTitle ?? l.title,
    description: l.assignmentDescription,
    criteria: l.assignmentCriteria,
    type: l.assignmentType ?? 'short',
    tags: l.assignmentTags ?? [],
    dueDate: session.dueDate,
    // В новой модели групп заданий нет; веб читает `!a.groupId` для бейджа
    // «Индивидуальное» — отдаём null, чтобы поведение сохранилось.
    groupId: null,
    materials: l.assignmentMaterials ?? [],
    lesson: { id: l.id, title: l.title },
    ...(session.stream ? { stream: session.stream } : {}),
    ...(session._count ? { _count: session._count } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

// Достраивает спроецированное задание ре-подписанными materials.
async function finalizeAssignment(
  projected: ReturnType<typeof projectAssignment>,
): Promise<Record<string, unknown>> {
  const materials = await regenerateMaterialUrls(
    (projected.materials as unknown as AssignmentMaterial[]) || [],
  );
  return { ...projected, materials };
}

export async function assignmentRoutes(app: FastifyInstance) {
  const adminOnly = requireRole('admin');
  const anyAuth = authenticate;

  // GET /assignments?streamId=xxx — список заданий потока.
  // Синтезируем по одному заданию на каждую Session потока, чей блок урока имеет
  // hasAssignment=true. id задания = sessionId.
  app.get('/assignments', { onRequest: anyAuth }, async (request, reply) => {
    const { streamId } = request.query as { streamId?: string };

    let stream: { id: string; name: string } | null = null;
    if (streamId) {
      stream = await prisma.stream.findUnique({
        where: { id: streamId },
        select: { id: true, name: true },
      });
      if (!stream) {
        return reply.status(404).send({ error: 'Поток не найден' });
      }
    }

    const sessions = (await prisma.session.findMany({
      where: {
        ...(streamId ? { streamId } : {}),
        lesson: { hasAssignment: true },
      },
      select: {
        ...sessionAssignmentSelect,
        stream: { select: { id: true, name: true } },
        _count: { select: { studentAssignments: true } },
      },
      orderBy: { createdAt: 'desc' },
    })) as unknown as SessionWithLesson[];

    const assignments = await Promise.all(
      sessions.map((s) => finalizeAssignment(projectAssignment(s))),
    );

    return { assignments };
  });

  // GET /assignments/:id — получить задание (id = sessionId).
  app.get('/assignments/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const session = (await prisma.session.findUnique({
      where: { id },
      select: {
        ...sessionAssignmentSelect,
        stream: { select: { id: true, name: true } },
        _count: { select: { studentAssignments: true } },
      },
    })) as unknown as SessionWithLesson | null;

    if (!session || !session.lesson.hasAssignment) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    const assignment = await finalizeAssignment(projectAssignment(session));

    return { assignment };
  });

  // POST /assignments — создание задания (admin).
  // Пишет assignment*-поля в БЛОК выбранного урока (hasAssignment=true),
  // upsert-ит Session(streamId, lessonId) с dueDate, затем автоматически выдаёт
  // StudentAssignment(sessionId, studentId, 'assigned') всем зачисленным студентам.
  app.post('/assignments', { onRequest: adminOnly }, async (request, reply) => {
    const body = request.body as {
      streamId: string;
      title: string;
      description?: string;
      criteria?: string | null;
      type?: 'short' | 'long';
      tags?: string[];
      dueDate?: string;
      lessonId?: string;
      materials?: AssignmentMaterial[];
    };

    if (!body.streamId) {
      return reply.status(400).send({ error: 'streamId обязателен' });
    }

    if (!body.title || !body.title.trim()) {
      return reply.status(400).send({ error: 'Название задания обязательно' });
    }

    if (!body.lessonId) {
      return reply.status(400).send({ error: 'Урок обязателен для задания' });
    }

    if (body.type && !['short', 'long'].includes(body.type)) {
      return reply.status(400).send({ error: 'Тип задания: short или long' });
    }

    const stream = await prisma.stream.findUnique({ where: { id: body.streamId } });
    if (!stream) {
      return reply.status(404).send({ error: 'Поток не найден' });
    }

    if (stream.status === 'archived') {
      return reply.status(400).send({ error: 'Нельзя добавлять задания в архивный поток' });
    }

    const lesson = await prisma.lesson.findUnique({ where: { id: body.lessonId } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    const materials = JSON.parse(JSON.stringify(Array.isArray(body.materials) ? body.materials : []));

    // 1) Пишем folded assignment*-поля в БЛОК урока.
    await prisma.lesson.update({
      where: { id: body.lessonId },
      data: {
        hasAssignment: true,
        assignmentTitle: body.title.trim(),
        assignmentDescription: body.description || null,
        assignmentCriteria: body.criteria || null,
        assignmentType: body.type || 'short',
        assignmentTags: body.tags || [],
        assignmentMaterials: materials,
      },
    });

    // 2) Дедлайн — на Session потока (создаём её при необходимости).
    const session = (await prisma.session.upsert({
      where: { streamId_lessonId: { streamId: body.streamId, lessonId: body.lessonId } },
      create: {
        streamId: body.streamId,
        lessonId: body.lessonId,
        dueDate,
      },
      update: { dueDate },
      select: {
        ...sessionAssignmentSelect,
        stream: { select: { id: true, name: true } },
      },
    })) as unknown as SessionWithLesson;

    // 3) Студенты, зачисленные на поток.
    const enrollments = await prisma.streamEnrollment.findMany({
      where: { streamId: body.streamId },
      select: { userId: true },
    });
    const studentIds = enrollments.map((e) => e.userId);

    // 4) Автоматически выдаём задание всем зачисленным студентам (по sessionId).
    if (studentIds.length > 0) {
      await prisma.studentAssignment.createMany({
        data: studentIds.map((studentId) => ({
          sessionId: session.id,
          studentId,
          status: 'assigned' as const,
        })),
        skipDuplicates: true,
      });
    }

    const assignment = await finalizeAssignment(
      projectAssignment({ ...session, _count: { studentAssignments: studentIds.length } }),
    );

    // Уведомляем только зачисленных студентов.
    notifyMany(
      studentIds,
      'assignment_created',
      'Новое задание',
      `Добавлено задание «${assignment.title}»`,
      { assignmentId: session.id, streamId: body.streamId },
    ).catch(() => {});

    return reply.status(201).send({ assignment });
  });

  // PATCH /assignments/:id — обновление задания (admin). id = sessionId.
  // assignment*-поля → блок урока этой Session; dueDate → Session.
  app.patch('/assignments/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      description?: string;
      criteria?: string | null;
      type?: 'short' | 'long';
      tags?: string[];
      dueDate?: string | null;
      lessonId?: string | null;
      materials?: AssignmentMaterial[];
    };

    const existing = (await prisma.session.findUnique({
      where: { id },
      select: sessionAssignmentSelect,
    })) as unknown as SessionWithLesson | null;

    if (!existing || !existing.lesson.hasAssignment) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    if (body.title !== undefined && !body.title.trim()) {
      return reply.status(400).send({ error: 'Название задания не может быть пустым' });
    }

    if (body.type !== undefined && !['short', 'long'].includes(body.type)) {
      return reply.status(400).send({ error: 'Тип задания: short или long' });
    }

    // Обновление folded assignment*-полей блока урока.
    const lessonData: Record<string, unknown> = {};
    if (body.title !== undefined) lessonData.assignmentTitle = body.title.trim();
    if (body.description !== undefined) lessonData.assignmentDescription = body.description || null;
    if (body.criteria !== undefined) lessonData.assignmentCriteria = body.criteria || null;
    if (body.type !== undefined) lessonData.assignmentType = body.type;
    if (body.tags !== undefined) lessonData.assignmentTags = body.tags;
    if (body.materials !== undefined) {
      lessonData.assignmentMaterials = JSON.parse(
        JSON.stringify(Array.isArray(body.materials) ? body.materials : []),
      );
    }

    if (Object.keys(lessonData).length > 0) {
      await prisma.lesson.update({
        where: { id: existing.lessonId },
        data: lessonData,
      });
    }

    // Дедлайн — поле Session.
    const sessionData: Record<string, unknown> = {};
    if (body.dueDate !== undefined) sessionData.dueDate = body.dueDate ? new Date(body.dueDate) : null;

    if (Object.keys(sessionData).length > 0) {
      await prisma.session.update({
        where: { id },
        data: sessionData,
      });
    }

    const session = (await prisma.session.findUnique({
      where: { id },
      select: {
        ...sessionAssignmentSelect,
        stream: { select: { id: true, name: true } },
        _count: { select: { studentAssignments: true } },
      },
    })) as unknown as SessionWithLesson;

    const assignment = await finalizeAssignment(projectAssignment(session));

    return { assignment };
  });

  // DELETE /assignments/:id — удаление задания (admin). id = sessionId.
  // Снимаем задание с БЛОКА урока (hasAssignment=false + очищаем assignment*-поля)
  // и удаляем StudentAssignment этой Session.
  app.delete('/assignments/:id', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = (await prisma.session.findUnique({
      where: { id },
      select: { id: true, lessonId: true, lesson: { select: { hasAssignment: true } } },
    })) as { id: string; lessonId: string; lesson: { hasAssignment: boolean } } | null;

    if (!existing || !existing.lesson.hasAssignment) {
      return reply.status(404).send({ error: 'Задание не найдено' });
    }

    // Очищаем задание на блоке урока.
    await prisma.lesson.update({
      where: { id: existing.lessonId },
      data: {
        hasAssignment: false,
        assignmentTitle: null,
        assignmentDescription: null,
        assignmentCriteria: null,
        assignmentType: null,
        assignmentTags: [],
        assignmentMaterials: [],
      },
    });

    // Удаляем сдачи этого задания (по sessionId).
    await prisma.studentAssignment.deleteMany({ where: { sessionId: id } });

    return { message: 'Задание удалено' };
  });

  // POST /assignments/upload-material — upload a file to S3 for use as assignment material (admin)
  app.post('/assignments/upload-material', { onRequest: adminOnly }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const chunks: Buffer[] = [];
    await pipeline(
      data.file,
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
    );

    const buffer = Buffer.concat(chunks);
    const mimeType = data.mimetype || 'application/octet-stream';
    const originalName = data.filename || 'file';

    const { key, url, size } = await uploadFile(buffer, originalName, mimeType, 'assignments');

    const material: AssignmentMaterial = {
      type: 'file',
      name: originalName,
      url,
      size,
      s3Key: key,
    };

    return reply.status(201).send({ material });
  });

  // GET /students/:id/assignments-summary — сводная статистика по статусам (admin).
  // overdue считаем по Session.dueDate (StudentAssignment → session → dueDate).
  app.get('/students/:id/assignments-summary', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const student = await prisma.user.findUnique({ where: { id } });
    if (!student || student.role !== 'student') {
      return reply.status(404).send({ error: 'Ученик не найден' });
    }

    const now = new Date();

    const statusCounts = await prisma.studentAssignment.groupBy({
      by: ['status'],
      where: { studentId: id },
      _count: { status: true },
    });

    const overdueCount = await prisma.studentAssignment.count({
      where: {
        studentId: id,
        status: { not: 'reviewed' },
        session: { dueDate: { lt: now, not: null } },
      },
    });

    const summary: Record<string, number> = {
      assigned: 0,
      submitted: 0,
      reviewed: 0,
      needs_revision: 0,
      overdue: overdueCount,
      total: 0,
    };

    for (const item of statusCounts) {
      summary[item.status] = item._count.status;
      summary.total += item._count.status;
    }

    return { summary };
  });

  // GET /student-assignments — список назначений ученика со статусами.
  // Фильтрация потока — через session.streamId. Каждый ряд проецируется так, чтобы
  // веб по-прежнему видел легаси-объект `sa.assignment` (id = sessionId).
  app.get('/student-assignments', { onRequest: anyAuth }, async (request, reply) => {
    const { streamId, status, studentId } = request.query as { streamId?: string; status?: string; studentId?: string };
    const isAdmin = request.user?.role === 'admin';
    const userId = request.user!.userId;

    const where: Record<string, unknown> = {};

    if (!isAdmin) {
      where.studentId = userId;
    } else if (studentId) {
      where.studentId = studentId;
    }

    if (streamId) {
      where.session = { ...((where.session as object) || {}), streamId };
    }

    if (status) {
      const statuses = status.split(',').filter((s) => ['assigned', 'submitted', 'reviewed', 'needs_revision'].includes(s));
      if (statuses.length > 0) {
        where.status = { in: statuses };
      }
    }

    const studentAssignments = await prisma.studentAssignment.findMany({
      where,
      include: {
        session: {
          select: {
            ...sessionAssignmentSelect,
            stream: { select: { id: true, name: true } },
          },
        },
        student: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Reshape: проецируем session+lesson в легаси `assignment`; ре-подписываем
    // ссылки на файлы (сдача + материалы задания). Своиполя StudentAssignment
    // сохраняем как есть.
    const results = await Promise.all(
      studentAssignments.map(async (sa) => {
        const { session, ...rest } = sa as typeof sa & { session: SessionWithLesson };
        const assignment = await finalizeAssignment(projectAssignment(session));

        const projected: Record<string, unknown> = {
          ...rest,
          assignmentId: session.id,
          assignment,
        };

        if (sa.fileUrl) {
          projected.fileSignedUrl = await getFileUrl(sa.fileUrl);
        }

        return projected;
      }),
    );

    return { studentAssignments: results };
  });

  // PATCH /student-assignments/:id — смена статуса + ответ (текст/файл).
  // Принимает JSON или multipart/form-data (когда есть файл).
  app.patch('/student-assignments/:id', { onRequest: anyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const isAdmin = request.user?.role === 'admin';
    const userId = request.user!.userId;

    // Parse body: JSON or multipart
    let status: string | undefined;
    let answerText: string | undefined;
    let studentComment: string | undefined;
    let reviewText: string | undefined;
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileMimeType = '';

    const contentType = request.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
          fileName = part.filename;
          fileMimeType = part.mimetype;
        } else if (part.type === 'field') {
          const value = part.value as string;
          if (part.fieldname === 'status') status = value;
          else if (part.fieldname === 'answerText') answerText = value;
          else if (part.fieldname === 'studentComment') studentComment = value;
          else if (part.fieldname === 'reviewText') reviewText = value;
        }
      }
    } else {
      const body = request.body as Record<string, string>;
      status = body.status;
      answerText = body.answerText;
      studentComment = body.studentComment;
      reviewText = body.reviewText;
    }

    // Подгружаем сдачу с её Session и блоком урока (с преподавателями для уведомлений).
    const sa = await prisma.studentAssignment.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            lesson: {
              include: {
                teachers: { include: { user: { select: { id: true, isActive: true, deletedAt: true } } } },
              },
            },
          },
        },
      },
    });

    if (!sa) {
      return reply.status(404).send({ error: 'Назначение не найдено' });
    }

    if (!status || !['submitted', 'reviewed', 'needs_revision'].includes(status)) {
      return reply.status(400).send({ error: 'Статус: submitted, reviewed или needs_revision' });
    }

    // Студент может только отправить (submitted), админ — reviewed/needs_revision
    if (!isAdmin && sa.studentId !== userId) {
      return reply.status(403).send({ error: 'Нет доступа' });
    }

    if (!isAdmin && status !== 'submitted') {
      return reply.status(403).send({ error: 'Студент может только отправить задание (submitted)' });
    }

    // Студент может отправить/переотправить, пока работа не взята в проверку:
    // из assigned, needs_revision (пересдача) и submitted (правка/дослать).
    // Из reviewed запрещено — после проверки сдача заморожена.
    if (!isAdmin && sa.status !== 'assigned' && sa.status !== 'needs_revision' && sa.status !== 'submitted') {
      return reply.status(400).send({ error: 'Задание уже проверено и не может быть изменено' });
    }

    // Админ: reviewed/needs_revision только из submitted
    if (isAdmin && (status === 'reviewed' || status === 'needs_revision') && sa.status !== 'submitted') {
      return reply.status(400).send({ error: 'Проверить можно только отправленное задание' });
    }

    const data: Record<string, unknown> = { status };
    if (status === 'submitted') {
      data.submittedAt = new Date();
      if (answerText) data.content = answerText;
      if (studentComment) data.studentComment = studentComment;

      // Upload file if provided
      if (fileBuffer && fileName) {
        const uploaded = await uploadFile(fileBuffer, fileName, fileMimeType);
        data.fileUrl = uploaded.key;
        data.fileName = fileName;
        data.fileSize = uploaded.size;
      }
    }
    // На доработку: причина обязательна (баллов нет — только Принято/На доработку).
    if (status === 'needs_revision' && (!reviewText || !reviewText.trim())) {
      return reply.status(400).send({ error: 'Укажите причину доработки' });
    }
    // Разбор работы: вердикт (reviewed/needs_revision) + текст разбора + автор.
    // Автор — имя проверяющего админа (в будущем может быть «Claude»).
    if (status === 'reviewed' || status === 'needs_revision') {
      if (reviewText !== undefined) data.reviewText = reviewText || null;
      const reviewer = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      data.reviewedBy = reviewer?.name || null;
    }
    if (status === 'reviewed') {
      data.reviewedAt = new Date();
    }

    const updatedRow = await prisma.studentAssignment.update({
      where: { id },
      data,
      include: {
        session: {
          select: {
            ...sessionAssignmentSelect,
            stream: { select: { id: true, name: true } },
          },
        },
        student: { select: { id: true, name: true, email: true } },
      },
    });

    const updatedSession = updatedRow.session as unknown as SessionWithLesson;
    const assignment = await finalizeAssignment(projectAssignment(updatedSession));
    const updated: Record<string, unknown> = {
      ...updatedRow,
      assignmentId: updatedSession.id,
      assignment,
    };

    // Создаём ConversationEntry о сдаче, чтобы преподаватель видел её в треде.
    if (status === 'submitted') {
      // Авто-создание персонального канала, если ученик ещё не открывал тред.
      let thread = await prisma.conversation.findUnique({
        where: { studentId: sa.studentId },
      });
      if (!thread) {
        thread = await prisma.conversation.create({ data: { studentId: sa.studentId, type: 'student' } });
      }

      if (thread) {
        const entryContent = answerText || `Сдано задание «${assignment.title}»`;
        const entryMetadata: Record<string, unknown> = {
          submissionType: 'assignment',
          studentAssignmentId: updatedRow.id,
        };

        if (updatedRow.fileUrl) {
          entryMetadata.s3Key = updatedRow.fileUrl;
          entryMetadata.fileName = updatedRow.fileName;
          entryMetadata.mimeType = fileMimeType || null;
          entryMetadata.size = updatedRow.fileSize;
        }

        await prisma.conversationEntry.create({
          data: {
            conversationId: thread.id,
            authorId: sa.studentId,
            type: updatedRow.fileUrl ? 'file' : 'text',
            content: entryContent,
            metadata: (entryMetadata as Parameters<typeof prisma.conversationEntry.create>[0]['data']['metadata']),
            // ConversationEntry привязан к уроку (lessonId), а не к заданию.
            lessonId: sa.session.lessonId,
          },
        });
      }
    }

    // Generate signed URL for file if present
    if (updatedRow.fileUrl) {
      updated.fileSignedUrl = await getFileUrl(updatedRow.fileUrl);
    }

    // Notify relevant parties about status change
    if (status === 'submitted') {
      // Адресно: уведомляем преподавателей урока задания (LessonTeacher).
      // Если преподавателей нет — фолбэк на всех админов.
      let recipientIds: string[] = sa.session.lesson.teachers
        .filter((t) => t.user.isActive && t.user.deletedAt === null)
        .map((t) => t.user.id);

      if (recipientIds.length === 0) {
        const admins = await prisma.user.findMany({
          where: { role: 'admin', isActive: true, deletedAt: null },
          select: { id: true },
        });
        recipientIds = admins.map((a) => a.id);
      }
      notifyMany(
        recipientIds,
        'assignment_submitted',
        'Студент сдал задание',
        `${updatedRow.student!.name} сдал задание «${assignment.title}»`,
        { studentAssignmentId: updatedRow.id, assignmentId: updatedSession.id, studentId: updatedRow.studentId },
      ).catch(() => {});
    } else if (status === 'reviewed') {
      createNotification({
        userId: updatedRow.studentId,
        type: 'assignment_reviewed',
        title: 'Задание проверено',
        body: `Ваше задание «${assignment.title}» проверено преподавателем`,
        metadata: { studentAssignmentId: updatedRow.id, assignmentId: updatedSession.id },
      }).catch(() => {});
    } else if (status === 'needs_revision') {
      createNotification({
        userId: updatedRow.studentId,
        type: 'assignment_reviewed',
        title: 'Задание на доработке',
        body: `Ваше задание «${assignment.title}» возвращено на доработку`,
        metadata: { studentAssignmentId: updatedRow.id, assignmentId: updatedSession.id },
      }).catch(() => {});
    }

    return { studentAssignment: updated };
  });
}
