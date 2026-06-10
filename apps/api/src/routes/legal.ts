import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@platform/db';

/**
 * Публичное чтение юридических документов (Волна 1 «правовой минимум»). БЕЗ JWT:
 * оферта/политики должны быть доступны до регистрации. Регистрируется отдельным
 * плагин-скоупом с локальным rate-limit (по образцу streams-public) — инкапсуляция
 * rate-limit НЕ затрагивает остальные роуты.
 *
 * Только чтение: версии документов выпускает разработчик (API на запись не даём).
 */
export async function legalPublicRoutes(app: FastifyInstance) {
  const getMax = Number(process.env.PUBLIC_LEGAL_RATE_LIMIT_MAX) || 60;

  await app.register(rateLimit, {
    max: getMax,
    timeWindow: '1 minute',
  });

  // GET /public/legal — список документов: slug, title и сводка по актуальной
  // опубликованной версии (versionNumber + publishedAt) или null, если версий нет.
  app.get('/public/legal', async () => {
    const docs = await prisma.legalDocument.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        slug: true,
        title: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true, publishedAt: true },
        },
      },
    });

    return {
      documents: docs.map((doc) => ({
        slug: doc.slug,
        title: doc.title,
        currentVersion: doc.versions[0] ?? null,
      })),
    };
  });

  // GET /public/legal/:slug — документ с ТЕКСТОМ актуальной (max versionNumber)
  // версии. 404 — если slug неизвестен; если версий ещё нет — body=null (фронт
  // покажет заглушку «документ готовится»).
  app.get('/public/legal/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const doc = await prisma.legalDocument.findUnique({
      where: { slug },
      select: {
        slug: true,
        title: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true, publishedAt: true, body: true },
        },
      },
    });

    if (!doc) {
      return reply.status(404).send({ error: 'Документ не найден' });
    }

    const version = doc.versions[0] ?? null;
    return {
      document: {
        slug: doc.slug,
        title: doc.title,
        versionNumber: version?.versionNumber ?? null,
        publishedAt: version?.publishedAt ?? null,
        body: version?.body ?? null,
      },
    };
  });
}
