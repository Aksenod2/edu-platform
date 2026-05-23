import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(import.meta.dirname!, '..', '..', '..', '.env') });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { MAX_FILE_SIZE } from './lib/s3.js';
import { prisma } from '@platform/db';
import { authRoutes } from './routes/auth.js';
import { streamRoutes } from './routes/streams.js';
import { userRoutes } from './routes/users.js';
import { lessonRoutes } from './routes/lessons.js';
import { programRoutes } from './routes/programs.js';
import { assignmentRoutes } from './routes/assignments.js';
import { walletRoutes } from './routes/wallet.js';
import { profileRoutes } from './routes/profiles.js';
import { threadRoutes } from './routes/threads.js';
import { conversationRoutes } from './routes/conversations.js';
import { notificationRoutes } from './routes/notifications.js';
import { pushSubscriptionRoutes } from './routes/push-subscriptions.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { fileRoutes } from './routes/files.js';
import { statsRoutes } from './routes/stats.js';
import { startCronJobs } from './lib/cron.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
});

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });

await app.register(rateLimit, {
  global: false,
});

// Rate limit on auth endpoints
await app.register(
  async (authScope) => {
    await authScope.register(rateLimit, {
      max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
      timeWindow: '1 minute',
    });
    await authScope.register(authRoutes);
  },
  { prefix: '' },
);

await app.register(streamRoutes);
await app.register(userRoutes);
await app.register(lessonRoutes);
await app.register(programRoutes);
await app.register(assignmentRoutes);
await app.register(walletRoutes);
await app.register(profileRoutes);
await app.register(threadRoutes);
await app.register(conversationRoutes);
await app.register(notificationRoutes);
await app.register(pushSubscriptionRoutes);
await app.register(apiKeyRoutes);
await app.register(fileRoutes);
await app.register(statsRoutes);

app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

app.get('/readiness', async () => {
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

// File storage uses PostgreSQL - no bucket init needed

// Start cron jobs: deadline reminders & notification cleanup
startCronJobs();
