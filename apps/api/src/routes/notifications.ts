import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma, type NotificationType } from '@platform/db';
import {
  CATEGORY_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  notificationPreferencesResponseSchema,
  updateNotificationPreferencesSchema,
  type NotificationCategory,
  type NotificationPreferencesResponse,
} from '@platform/shared/contracts';
import { authenticate } from '../middleware/auth.js';

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

  // ── Матрица настроек «категория × Email/Push» (issue #172, контракт #174) ───
  //
  // Контракт фронт↔бэк — ОДНА zod-схема из @platform/shared/contracts. Продуктовая
  // модель здесь — КАТЕГОРИЯ (строка матрицы); хранение — per-NotificationType
  // (`NotificationPreference`, читает lib/notifications.ts при отправке). Карта
  // CATEGORY_NOTIFICATION_TYPES раскрывает категорию в её типы: при PATCH один флаг
  // канала пишется во ВСЕ типы категории, при GET типы сворачиваются обратно.

  /**
   * Собирает category-based ответ для пользователя: читает все per-type строки,
   * для каждой категории берёт состояние её типов (все типы категории движутся
   * в лок-степ — представителя достаточно; дефолт ВКЛ, если строки нет).
   */
  async function readCategoryPreferences(
    userId: string,
  ): Promise<NotificationPreferencesResponse> {
    const matrixTypes = Object.values(CATEGORY_NOTIFICATION_TYPES).flat() as NotificationType[];
    const existing = await prisma.notificationPreference.findMany({
      where: { userId, type: { in: matrixTypes } },
    });
    const byType = new Map(existing.map((p) => [p.type, p]));

    const preferences = NOTIFICATION_CATEGORIES.map((category) => {
      const types = CATEGORY_NOTIFICATION_TYPES[category] as readonly NotificationType[];
      // Email/Push включён для категории, если ВКЛ хотя бы у одного её типа
      // (типы пишутся вместе, поэтому на практике все равны; some — безопасный
      // дефолт при частично отсутствующих строках, дефолт типа — ВКЛ).
      const channelEmail = types.some((t) => byType.get(t)?.emailEnabled ?? true);
      const channelPush = types.some((t) => byType.get(t)?.pushEnabled ?? true);
      return { category, channelEmail, channelPush };
    });

    return { preferences };
  }

  // Типизированный инстанс (zod type provider): даёт вывод типа request.body из
  // schema.body для роутов матрицы. Хуки/префиксы наследуются от app.
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // GET /notification-preferences — настройки матрицы по категориям.
  typed.get(
    '/notification-preferences',
    { schema: { response: { 200: notificationPreferencesResponseSchema } } },
    async (request) => {
      const userId = request.user!.userId;
      return readCategoryPreferences(userId);
    },
  );

  // PATCH /notification-preferences — обновить категории матрицы.
  // Тело валидируется zod-схемой из shared (validatorCompiler) — несовпадение
  // формы становится 400 ДО хендлера, без ручного `Array.isArray`.
  typed.patch(
    '/notification-preferences',
    {
      schema: {
        body: updateNotificationPreferencesSchema,
        response: { 200: notificationPreferencesResponseSchema },
      },
    },
    async (request) => {
      const userId = request.user!.userId;
      const { preferences } = request.body;

      // Раскрываем каждую категорию в её NotificationType и апсертим переданные
      // каналы во все типы категории (частичное обновление: незаданный канал не трогаем).
      const upserts: Array<Promise<unknown>> = [];
      for (const item of preferences) {
        const types = CATEGORY_NOTIFICATION_TYPES[item.category as NotificationCategory] as
          | readonly NotificationType[]
          | undefined;
        if (!types) continue;
        for (const type of types) {
          upserts.push(
            prisma.notificationPreference.upsert({
              where: { userId_type: { userId, type } },
              create: {
                userId,
                type,
                emailEnabled: item.channelEmail ?? true,
                pushEnabled: item.channelPush ?? true,
                inAppEnabled: true,
              },
              update: {
                ...(item.channelEmail !== undefined ? { emailEnabled: item.channelEmail } : {}),
                ...(item.channelPush !== undefined ? { pushEnabled: item.channelPush } : {}),
              },
            }),
          );
        }
      }
      await Promise.all(upserts);

      return readCategoryPreferences(userId);
    },
  );

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
