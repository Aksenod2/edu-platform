import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@platform/db';
import { verifyFileSignature, readFile, verifyStoredObject } from '../lib/s3.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { requireRole } from '../middleware/auth.js';

/**
 * Resolve a Bearer token (JWT or `sk_` API key) to an admin user.
 * Returns true only if the request carries valid admin credentials.
 * Does not send a reply — callers decide how to respond.
 */
async function isAdminBearer(request: FastifyRequest): Promise<boolean> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);

  if (token.startsWith('sk_')) {
    const keyHash = createHash('sha256').update(token).digest('hex');
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true },
    });

    if (!apiKey || apiKey.revokedAt !== null) {
      return false;
    }
    if (!apiKey.user.isActive || apiKey.user.deletedAt !== null) {
      return false;
    }

    // Fire-and-forget: update lastUsedAt
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return apiKey.user.role === 'admin';
  }

  try {
    const payload = verifyAccessToken(token);
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

export async function fileRoutes(app: FastifyInstance) {
  // DELETE /admin/files — удалить ВСЕ загруженные файлы (admin).
  // Чистит хранилище PostgreSQL и обнуляет ссылки на файлы в уроках (включая
  // материалы заданий, свёрнутые в Lesson), сессиях и сдачах, а также удаляет
  // файловые/аудио-сообщения. Нужно для сброса тестовых данных при переходе на
  // S3 (новые файлы поедут в S3). Необратимо.
  app.delete('/admin/files', { onRequest: requireRole('admin') }, async () => {
    const [files, lessonsVideo, lessonVideosDeleted, lessonsMat, sessionsVideo, subs, fileMsgs] =
      await prisma.$transaction([
        prisma.fileStorage.deleteMany({}),
        prisma.lesson.updateMany({ where: { NOT: { videoKey: null } }, data: { videoKey: null } }),
        // Новые видео урока (LessonVideo): удаляем только видео-ФАЙЛЫ (videoKey задан);
        // внешние ссылки (videoUrl) оставляем — они не хранятся в файловом хранилище.
        prisma.lessonVideo.deleteMany({ where: { NOT: { videoKey: null } } }),
        // Очищаем материалы блока урока И вложенные материалы задания (свёрнуты в Lesson).
        prisma.lesson.updateMany({ data: { assignmentMaterials: [], materials: [] } }),
        // Записи проводятся на уровне сессии (per-run recordings) — обнуляем видео сессий.
        prisma.session.updateMany({
          where: { OR: [{ NOT: { videoKey: null } }, { NOT: { videoUrl: null } }] },
          data: { videoKey: null, videoUrl: null },
        }),
        prisma.studentAssignment.updateMany({
          where: { OR: [{ NOT: { fileUrl: null } }, { NOT: { fileName: null } }] },
          data: { fileUrl: null, fileName: null, fileSize: null },
        }),
        prisma.conversationEntry.deleteMany({ where: { type: { in: ['file', 'audio'] } } }),
      ]);

    return {
      deletedFiles: files.count,
      // Унаследованные одиночные видео урока (обнулённый Lesson.videoKey) +
      // удалённые видео-файлы из новой коллекции LessonVideo.
      clearedLessonVideos: lessonsVideo.count + lessonVideosDeleted.count,
      clearedLessonMaterials: lessonsMat.count,
      clearedSessionVideos: sessionsVideo.count,
      clearedSubmissionFiles: subs.count,
      deletedFileMessages: fileMsgs.count,
    };
  });

  // GET /files/:key - serve file from PostgreSQL storage.
  // Access is granted if EITHER:
  //   (a) the query carries a valid, non-expired signature, OR
  //   (b) the request carries a valid admin Bearer token (JWT or `sk_` API key).
  app.get('/files/*', async (request, reply) => {
    const key = (request.params as Record<string, string>)['*'];

    if (!key) {
      return reply.status(400).send({ error: 'File key required' });
    }

    const { exp, sig, download } = request.query as {
      exp?: string;
      sig?: string;
      download?: string;
    };

    // (a) Signature first — never 401 before this check.
    let authorized = false;
    if (exp && sig) {
      authorized = verifyFileSignature(key, exp, sig);
    }

    // (b) Fall back to admin Bearer credentials.
    if (!authorized) {
      authorized = await isAdminBearer(request);
    }

    if (!authorized) {
      return reply.status(401).send({ error: 'Доступ запрещён' });
    }

    const result = await readFile(key, request.headers.range);

    if (result.kind === 'not_found') {
      // ВРЕМЕННАЯ ДИАГНОСТИКА (баг «материалы урока → 404»): GET не нашёл объект.
      // Спрашиваем хранилище напрямую через HeadObject, чтобы различить причины
      // РАЗНЫМИ HTTP-кодами (лайтбокс показывает код): 404 — объекта нет (запись не
      // долетела); 403 — чтение запрещено (права на префикс); 502 — объект есть, но
      // GET его не отдал (рассинхрон/особенность чтения). Убрать после диагноза.
      const head = await verifyStoredObject(key);
      if (head.ok) {
        return reply
          .status(502)
          .send({ error: `Объект есть в хранилище (HeadObject ok), но GET вернул not_found — рассинхрон/особенность чтения. key=${key}` });
      }
      if (/403|AccessDenied|Forbidden/i.test(head.detail)) {
        return reply
          .status(403)
          .send({ error: `Чтение объекта запрещено хранилищем: ${head.detail}. key=${key}` });
      }
      return reply.status(404).send({ error: `File not found (${head.detail}). key=${key}` });
    }

    if (result.kind === 'range_not_satisfiable') {
      return reply.status(416).header('Content-Range', `bytes */${result.totalSize}`).send();
    }

    // ?download=1 — отдать как вложение (форс-скачивание), иначе inline (просмотр).
    // download нужен, т.к. HTML-атрибут download не работает для кросс-доменных ссылок.
    const disposition = download ? 'attachment' : 'inline';

    // Accept-Ranges сообщает браузеру, что можно запрашивать диапазоны — это нужно
    // для <video> (перемотка) и обязательно для Safari/iOS, который не воспроизводит
    // видео без ответа 206 на Range-запрос.
    reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', result.contentType)
      .header(
        'Content-Disposition',
        `${disposition}; filename="${encodeURIComponent(result.fileName)}"`,
      )
      .header('Cache-Control', 'private, max-age=3600');

    if (result.isPartial) {
      return reply
        .status(206)
        .header('Content-Range', `bytes ${result.start}-${result.end}/${result.totalSize}`)
        .header('Content-Length', result.contentLength)
        .send(result.body);
    }

    return reply.header('Content-Length', result.contentLength).send(result.body);
  });
}
