import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';

export async function fileRoutes(app: FastifyInstance) {
  // GET /files/:key - serve file from PostgreSQL storage
  app.get('/files/*', async (request, reply) => {
    const key = (request.params as Record<string, string>)['*'];

    if (!key) {
      return reply.status(400).send({ error: 'File key required' });
    }

    const file = await prisma.fileStorage.findUnique({
      where: { key },
    });

    if (!file) {
      return reply.status(404).send({ error: 'File not found' });
    }

    return reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', file.size)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
      .header('Cache-Control', 'public, max-age=3600')
      .send(Buffer.from(file.data));
  });
}
