import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(import.meta.dirname!, '..', '..', '..', '.env') });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@platform/db';
import { authRoutes } from './routes/auth.js';
import { streamRoutes } from './routes/streams.js';
import { userRoutes } from './routes/users.js';
import { lessonRoutes } from './routes/lessons.js';
import { scheduleRoutes } from './routes/schedule.js';
import { assignmentRoutes } from './routes/assignments.js';
import { profileRoutes } from './routes/profiles.js';
import { threadRoutes } from './routes/threads.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
});

await app.register(cookie);

await app.register(rateLimit, {
  global: false,
});

// Rate limit on auth endpoints
await app.register(
  async (authScope) => {
    await authScope.register(rateLimit, {
      max: 10,
      timeWindow: '1 minute',
    });
    await authScope.register(authRoutes);
  },
  { prefix: '' },
);

await app.register(streamRoutes);
await app.register(userRoutes);
await app.register(lessonRoutes);
await app.register(scheduleRoutes);
await app.register(assignmentRoutes);
await app.register(profileRoutes);
await app.register(threadRoutes);

app.get('/health', async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { status: 'ok', timestamp: new Date().toISOString() };
});

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`API server listening on ${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
