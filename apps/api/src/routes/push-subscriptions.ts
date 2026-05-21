import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { authenticate } from '../middleware/auth.js';
import { getVapidPublicKey } from '../lib/webpush.js';

export async function pushSubscriptionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /push-subscriptions/vapid-public-key — return VAPID public key for SW registration
  app.get('/push-subscriptions/vapid-public-key', async () => {
    const key = getVapidPublicKey();
    if (!key) {
      return { vapidPublicKey: null };
    }
    return { vapidPublicKey: key };
  });

  // POST /push-subscriptions — register subscription
  app.post('/push-subscriptions', async (request, reply) => {
    const userId = request.user!.userId;
    const body = request.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return reply.status(400).send({ error: 'endpoint, keys.p256dh и keys.auth обязательны' });
    }

    // Upsert: if same endpoint exists for another user, reassign to current user
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    return reply.status(201).send({ subscription: { id: subscription.id } });
  });

  // DELETE /push-subscriptions/:id — unregister subscription
  app.delete('/push-subscriptions/:id', async (request, reply) => {
    const userId = request.user!.userId;
    const { id } = request.params as { id: string };

    const sub = await prisma.pushSubscription.findUnique({ where: { id } });

    if (!sub) {
      return reply.status(404).send({ error: 'Подписка не найдена' });
    }

    if (sub.userId !== userId) {
      return reply.status(403).send({ error: 'Нет доступа' });
    }

    await prisma.pushSubscription.delete({ where: { id } });

    return { message: 'Подписка удалена' };
  });
}
