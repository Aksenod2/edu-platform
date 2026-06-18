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
  // onRequest (а не preHandler): request.user должен быть установлен ДО
  // глобального preHandler-гейта согласий (consent-gate, issue #119).
  app.addHook('onRequest', authenticate);

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

  // DELETE /notifications/:id — удалить уведомление текущего пользователя.
  // Идемпотентно: deleteMany с фильтром { id, userId } (нельзя удалить чужое —
  // фильтр по userId; если уже удалено — вернётся success без ошибки).
  app.delete('/notifications/:id', async (request) => {
    const userId = request.user!.userId;
    const { id } = request.params as { id: string };

    await prisma.notification.deleteMany({
      where: { id, userId },
    });

    return { success: true };
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

  // ── Настройки напоминаний о занятиях/встречах (issue #169) ─────────────────
  //
  // УЗКИЙ эндпоинт, НЕ через ALL_NOTIFICATION_TYPES/матрицу: у напоминаний нет
  // email/in-app-канала (push заблокированы email/telegram ТСПУ → только push),
  // поэтому хранится один флаг pushEnabled на тип. Два независимых тумблера:
  //   event_reminder_60 → remind60, event_reminder_15 → remind15.
  // Дефолт — ВКЛ (true): нет записи NotificationPreference ⇒ напоминание включено.
  // Доступно любой авторизованной роли — каждый управляет СВОИМИ (фильтр по userId).
  const REMIND_60: NotificationType = 'event_reminder_60';
  const REMIND_15: NotificationType = 'event_reminder_15';

  // GET /event-reminder-preferences → { remind60, remind15 } (дефолт ВКЛ).
  app.get('/event-reminder-preferences', async (request) => {
    const userId = request.user!.userId;
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId, type: { in: [REMIND_60, REMIND_15] } },
      select: { type: true, pushEnabled: true },
    });
    const byType = new Map(prefs.map((p) => [p.type, p.pushEnabled]));
    return {
      remind60: byType.get(REMIND_60) ?? true,
      remind15: byType.get(REMIND_15) ?? true,
    };
  });

  // PATCH /event-reminder-preferences body { remind60?, remind15? } → актуальные
  // { remind60, remind15 }. Меняем только переданные флаги (upsert по userId_type).
  app.patch('/event-reminder-preferences', async (request, reply) => {
    const userId = request.user!.userId;
    const body = (request.body ?? {}) as { remind60?: unknown; remind15?: unknown };

    if (body.remind60 !== undefined && typeof body.remind60 !== 'boolean') {
      return reply.status(400).send({ error: 'remind60 должно быть булевым' });
    }
    if (body.remind15 !== undefined && typeof body.remind15 !== 'boolean') {
      return reply.status(400).send({ error: 'remind15 должно быть булевым' });
    }

    // Собираем только реально переданные тумблеры → их и апсертим (pushEnabled).
    const updates: Array<{ type: NotificationType; value: boolean }> = [];
    if (typeof body.remind60 === 'boolean') updates.push({ type: REMIND_60, value: body.remind60 });
    if (typeof body.remind15 === 'boolean') updates.push({ type: REMIND_15, value: body.remind15 });

    await Promise.all(
      updates.map((u) =>
        prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: u.type } },
          // Прочие каналы держим true (для reminder используется только pushEnabled);
          // явный true не ломает дефолт-ВКЛ для типов без email/in-app-доставки.
          create: {
            userId,
            type: u.type,
            emailEnabled: true,
            pushEnabled: u.value,
            inAppEnabled: true,
          },
          update: { pushEnabled: u.value },
        }),
      ),
    );

    // Возвращаем актуальное состояние (перечитываем — дефолт ВКЛ для незаданных).
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId, type: { in: [REMIND_60, REMIND_15] } },
      select: { type: true, pushEnabled: true },
    });
    const byType = new Map(prefs.map((p) => [p.type, p.pushEnabled]));
    return {
      remind60: byType.get(REMIND_60) ?? true,
      remind15: byType.get(REMIND_15) ?? true,
    };
  });
}
