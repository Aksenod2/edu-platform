import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole, authenticate } from '../middleware/auth.js';
import { notifyMany } from '../lib/notifications.js';
import { isEnrolled } from '../lib/enrollment.js';
import { uploadFile, getFileUrl } from '../lib/s3.js';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

// Дескриптор учебного материала урока (только PDF/MD).
// Файл хранится в FileStorage по s3Key; url — подписанная временная ссылка,
// которую ре-подписываем при каждой выдаче GET.
export interface LessonMaterial {
  s3Key: string;
  fileName: string;
  mimeType: string;
  size: number;
  url?: string;
}

// Подписанный временный URL загруженного видео урока по videoKey (или null).
// Если videoKey пуст — видео загружено не было (есть только внешняя ссылка videoUrl).
async function videoFileUrlFor(videoKey: string | null | undefined): Promise<string | null> {
  if (!videoKey) return null;
  try {
    return await getFileUrl(videoKey);
  } catch {
    return null;
  }
}

// Ре-подписывает временные url по s3Key для всех материалов урока.
async function regenerateLessonMaterialUrls(
  materials: LessonMaterial[],
): Promise<LessonMaterial[]> {
  return Promise.all(
    materials.map(async (m) => {
      if (m.s3Key) {
        try {
          return { ...m, url: await getFileUrl(m.s3Key) };
        } catch {
          return m;
        }
      }
      return m;
    }),
  );
}

// Нормализует входной массив дескрипторов материалов (из POST/PATCH):
// храним только s3Key/fileName/mimeType/size, url не сохраняем (он временный).
function sanitizeLessonMaterials(input: unknown): LessonMaterial[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter((m) => typeof m.s3Key === 'string' && typeof m.fileName === 'string')
    .map((m) => ({
      s3Key: m.s3Key as string,
      fileName: m.fileName as string,
      mimeType: typeof m.mimeType === 'string' ? m.mimeType : 'application/octet-stream',
      size: typeof m.size === 'number' ? m.size : 0,
    }));
}

// Допускаем строго PDF и Markdown. mime для .md часто пустой/text/plain,
// поэтому проверяем И mime, И расширение имени файла.
const PDF_MD_MIME_TYPES = new Set([
  'application/pdf',
  'text/markdown',
  'text/x-markdown',
]);

function isPdfOrMarkdown(fileName: string, mimeType: string): boolean {
  const lowerName = (fileName || '').toLowerCase();
  if (lowerName.endsWith('.pdf') || lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return true;
  }
  return PDF_MD_MIME_TYPES.has((mimeType || '').toLowerCase());
}

// Допускаем видеофайлы по расширению И mime. Проверяем оба, т.к. браузеры/ОС
// иногда отдают пустой/неточный mime для .mov/.m4v.
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v'];

function isVideoFile(fileName: string, mimeType: string): boolean {
  const lowerName = (fileName || '').toLowerCase();
  const okExt = VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const okMime = (mimeType || '').toLowerCase().startsWith('video/');
  return okExt && okMime;
}

// include-конфиг для подгрузки преподавателей урока и его записи расписания.
// Берём ТОЛЬКО запись, управляемую из карточки урока (managedByLesson) — это
// «дата занятия» урока. Записи, заведённые вручную через раздел «Расписание»,
// не относятся к этому полю и не трогаются.
const teacherInclude = {
  teachers: { include: { user: { select: { id: true, name: true } } } },
  scheduleEntries: {
    where: { managedByLesson: true },
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

// Синхронизация записи расписания (ScheduleEntry), УПРАВЛЯЕМОЙ из карточки урока
// (managedByLesson=true). scheduledAt — наивная локальная строка "YYYY-MM-DDTHH:MM":
//   задана  → создаём/обновляем единственную managed-запись урока;
//   очищена → удаляем только managed-запись урока.
// Записи, заведённые вручную через раздел «Расписание» (managedByLesson=false),
// НИКОГДА не трогаем — даже если у них тот же lessonId.
// Если в строке нет времени (timePart пустой) — синхронизацию пропускаем.
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
      where: { lessonId: lesson.id, managedByLesson: true },
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
          managedByLesson: true,
        },
      });
    }
  } else {
    await prisma.scheduleEntry.deleteMany({
      where: { lessonId: lesson.id, managedByLesson: true },
    });
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
      include: { ...teacherInclude, stream: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    const shaped = await Promise.all(
      lessons.map(async (lesson) => {
        const base = shapeLesson(lesson);
        return {
          ...base,
          videoFileUrl: await videoFileUrlFor(lesson.videoKey),
          materials: await regenerateLessonMaterialUrls(
            (lesson.materials as unknown as LessonMaterial[]) || [],
          ),
        };
      }),
    );

    return { lessons: shaped };
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

    const materials = await regenerateLessonMaterialUrls(
      (lesson.materials as unknown as LessonMaterial[]) || [],
    );
    const videoFileUrl = await videoFileUrlFor(lesson.videoKey);

    return { lesson: { ...shapeLesson(lesson), materials, videoFileUrl } };
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
      materials?: LessonMaterial[];
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
        materials: JSON.parse(JSON.stringify(sanitizeLessonMaterials(body.materials))),
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
      materials?: LessonMaterial[];
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
    if (body.materials !== undefined) {
      data.materials = JSON.parse(JSON.stringify(sanitizeLessonMaterials(body.materials)));
    }

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

    const materials = await regenerateLessonMaterialUrls(
      (lesson.materials as unknown as LessonMaterial[]) || [],
    );
    const videoFileUrl = await videoFileUrlFor(lesson.videoKey);

    return { lesson: { ...shapeLesson(lesson), materials, videoFileUrl } };
  });

  // POST /lessons/:id/materials — загрузка файла-материала урока (admin).
  // Принимаются строго PDF и Markdown (.md/.markdown). Файл кладётся в FileStorage
  // (folder 'lessons'), дескриптор добавляется в lesson.materials.
  // Возвращает обновлённый список материалов урока с подписанными url.
  app.post('/lessons/:id/materials', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const originalName = data.filename || 'file';
    const mimeType = data.mimetype || 'application/octet-stream';

    if (!isPdfOrMarkdown(originalName, mimeType)) {
      // Слив потока, чтобы не подвиснуть на необработанном файле.
      data.file.resume();
      return reply.status(400).send({ error: 'Поддерживаются только PDF и MD' });
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

    let uploaded: { key: string; url: string; size: number };
    try {
      uploaded = await uploadFile(buffer, originalName, mimeType, 'lessons');
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
    }

    const material: LessonMaterial = {
      s3Key: uploaded.key,
      fileName: originalName,
      mimeType,
      size: uploaded.size,
    };

    const current = sanitizeLessonMaterials(lesson.materials);
    const nextMaterials = [...current, material];

    await prisma.lesson.update({
      where: { id },
      data: { materials: JSON.parse(JSON.stringify(nextMaterials)) },
    });

    const materials = await regenerateLessonMaterialUrls(nextMaterials);

    return reply.status(201).send({ materials });
  });

  // DELETE /lessons/:id/materials/:s3Key — удаление материала урока (admin).
  // :s3Key передаётся URL-кодированным; убираем дескриптор из массива.
  app.delete('/lessons/:id/materials/:s3Key', { onRequest: adminOnly }, async (request, reply) => {
    const { id, s3Key } = request.params as { id: string; s3Key: string };
    const key = decodeURIComponent(s3Key);

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const current = sanitizeLessonMaterials(lesson.materials);
    const nextMaterials = current.filter((m) => m.s3Key !== key);

    await prisma.lesson.update({
      where: { id },
      data: { materials: JSON.parse(JSON.stringify(nextMaterials)) },
    });

    const materials = await regenerateLessonMaterialUrls(nextMaterials);

    return { materials };
  });

  // POST /lessons/:id/video — загрузка видеозаписи урока (admin).
  // Принимается ОДИН видеофайл (mp4/webm/mov/m4v, mime video/*). Файл кладётся в
  // FileStorage (folder 'lesson-videos'), ключ пишется в lesson.videoKey.
  // Возвращает обновлённый урок (с подписанным videoFileUrl).
  //
  // ВНИМАНИЕ: лимит размера НЕ повышаем — действует общий multipart-лимит
  // MAX_FILE_SIZE (50МБ) из server.ts. На текущем backend (файлы в PostgreSQL)
  // большие видео не загрузить — фича рассчитана на небольшие файлы/тест.
  // TODO: лимит поднять и перейти на presigned direct upload, когда подключат
  // объектное хранилище (S3).
  app.post('/lessons/:id/video', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    if (!request.isMultipart()) {
      return reply.status(400).send({ error: 'Ожидается multipart/form-data' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Файл не найден в запросе' });
    }

    const originalName = data.filename || 'video';
    const mimeType = data.mimetype || 'application/octet-stream';

    if (!isVideoFile(originalName, mimeType)) {
      // Слив потока, чтобы не подвиснуть на необработанном файле.
      data.file.resume();
      return reply.status(400).send({ error: 'Поддерживаются видеофайлы (MP4)' });
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

    let uploaded: { key: string; url: string; size: number };
    try {
      uploaded = await uploadFile(buffer, originalName, mimeType, 'lesson-videos');
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Ошибка загрузки файла' });
    }

    const updated = await prisma.lesson.update({
      where: { id },
      data: { videoKey: uploaded.key },
      include: teacherInclude,
    });

    const materials = await regenerateLessonMaterialUrls(
      (updated.materials as unknown as LessonMaterial[]) || [],
    );
    const videoFileUrl = await videoFileUrlFor(updated.videoKey);

    return reply.status(201).send({ lesson: { ...shapeLesson(updated), materials, videoFileUrl } });
  });

  // DELETE /lessons/:id/video — удаление загруженного видео урока (admin).
  // Обнуляем videoKey; физическое удаление объекта не обязательно (как у materials).
  app.delete('/lessons/:id/video', { onRequest: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      return reply.status(404).send({ error: 'Урок не найден' });
    }

    const updated = await prisma.lesson.update({
      where: { id },
      data: { videoKey: null },
      include: teacherInclude,
    });

    const materials = await regenerateLessonMaterialUrls(
      (updated.materials as unknown as LessonMaterial[]) || [],
    );
    const videoFileUrl = await videoFileUrlFor(updated.videoKey);

    return { lesson: { ...shapeLesson(updated), materials, videoFileUrl } };
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
