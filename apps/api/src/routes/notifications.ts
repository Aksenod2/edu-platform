import type { FastifyInstance } from 'fastify';
import { prisma, type NotificationType } from '@platform/db';
import { authenticate } from '../middleware/auth.js';

const ALL_NOTIFICATION_TYPES: NotificationType[] = [
  'lesson_published',
  'assignment_created',
  'deadline_reminder',
  'thread_entry',
  'assignment_submitted',
  'assignment_reviewed',
  'schedule_entry_created',
];

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /notifications/count?unread=true — lightweight badge counter
  app.get('/notifications/count', async (request, reply) => {
    const userId = request.user!.userId;
    const { unread } = request.query as { unread?: string };
    const where = unread === 'true' ? { userId, isRead: false } : { userId };
    const count = await prisma.notification.count({ where });
    return { count };
  });

  // GET /notifications?limit=50&unreadOnly=true — last N notifications for current user
  app.get('/notifications', async (request, reply) => {
    const userId = request.user!.userId;
    const { limit, unreadOnly } = request.query as { limit?: string; unreadOnly?: string };
    const take = Math.min(Number(limit) || 50, 200);

    const where = unreadOnly === 'true' ? { userId, isRead: false } : { userId };

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });

    const unreadCount = await prisma.notification.count({ where: { userId, isRead: false } });

    return { notifications, unreadCount };
  });

  // PATCH /notifications/read-all — mark all as read
  app.patch('/notifications/read-all', async (request, reply) => {
    const userId = request.user!.userId;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { message: 'Все уведомления отмечены как прочитанные' };
  });

  // PATCH /notifications/:id/read — mark single notification as read
  app.patch('/notifications/:id/read', async (request, reply) => {
    const userId = request.user!.userId;
    const { id } = request.params as { id: string };

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification) {
      return reply.status(404).send({ error: 'Уведомление не найдено' });
    }

    if (notification.userId !== userId) {
      return reply.status(403).send({ error: 'Нет доступа' });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return { notification: updated };
  });

  // GET /notification-preferences — get user preferences (all types)
  app.get('/notification-preferences', async (request, reply) => {
    const userId = request.user!.userId;

    const existing = await prisma.notificationPreference.findMany({ where: { userId } });
    const existingMap = new Map(existing.map((p) => [p.type, p]));

    // Return defaults for types not yet configured
    const preferences = ALL_NOTIFICATION_TYPES.map((type) => {
      const pref = existingMap.get(type);
      return {
        type,
        emailEnabled: pref?.emailEnabled ?? true,
        pushEnabled: pref?.pushEnabled ?? true,
        inAppEnabled: pref?.inAppEnabled ?? true,
      };
    });

    return { preferences };
  });

  // PATCH /notification-preferences — update user preferences
  app.patch('/notification-preferences', async (request, reply) => {
    const userId = request.user!.userId;
    const body = request.body as Array<{
      type: NotificationType;
      emailEnabled?: boolean;
      pushEnabled?: boolean;
      inAppEnabled?: boolean;
    }>;

    if (!Array.isArray(body) || body.length === 0) {
      return reply.status(400).send({ error: 'Тело запроса должно быть массивом настроек' });
    }

    for (const item of body) {
      if (!ALL_NOTIFICATION_TYPES.includes(item.type)) {
        return reply.status(400).send({ error: `Неизвестный тип уведомления: ${item.type}` });
      }
    }

    const upserted = await Promise.all(
      body.map((item) =>
        prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: item.type } },
          create: {
            userId,
            type: item.type,
            emailEnabled: item.emailEnabled ?? true,
            pushEnabled: item.pushEnabled ?? true,
            inAppEnabled: item.inAppEnabled ?? true,
          },
          update: {
            ...(item.emailEnabled !== undefined ? { emailEnabled: item.emailEnabled } : {}),
            ...(item.pushEnabled !== undefined ? { pushEnabled: item.pushEnabled } : {}),
            ...(item.inAppEnabled !== undefined ? { inAppEnabled: item.inAppEnabled } : {}),
          },
        }),
      ),
    );

    return { preferences: upserted };
  });
}
