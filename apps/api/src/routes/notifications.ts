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

// Категории матрицы уведомлений на фронте (CATEGORY_ROWS в
// apps/web/src/components/notification-settings.tsx) → их NotificationType[].
// Фронт оперирует КАТЕГОРИЯМИ (Email/Push), бэк хранит флаги per-type — это карта
// маппинга между ними. PATCH раскрывает категорию в её типы (пишет флаг канала во
// все типы), GET сворачивает type-записи обратно в категории.
//
// Псевдо-категория `system` (UI-only, «всегда вкл») и напоминания
// `event_reminder_60/15` (отдельный эндпоинт /event-reminder-preferences, issue
// #169) в эту карту НЕ входят.
type PreferenceCategory =
  | 'learning'
  | 'deadlines'
  | 'feedback'
  | 'schedule'
  | 'student_activity';

const CATEGORY_NOTIFICATION_TYPES: Record<PreferenceCategory, NotificationType[]> = {
  learning: ['lesson_published', 'assignment_created'],
  deadlines: ['deadline_reminder'],
  feedback: ['thread_entry', 'assignment_reviewed'],
  schedule: ['schedule_entry_created'],
  student_activity: ['assignment_submitted'],
};

const PREFERENCE_CATEGORIES = Object.keys(CATEGORY_NOTIFICATION_TYPES) as PreferenceCategory[];

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

  // Сворачивает per-type записи preference в category-форму фронта
  // ({ category, channelEmail, channelPush }). Дефолт ВКЛ для незаданных типов.
  // Канал категории = ВКЛ, если он включён хотя бы у одного типа категории
  // (любой непрочитанный тип = дефолт true). channelEmail ← emailEnabled,
  // channelPush ← pushEnabled.
  async function readCategoryPreferences(userId: string) {
    const existing = await prisma.notificationPreference.findMany({
      where: { userId, type: { in: ALL_NOTIFICATION_TYPES } },
    });
    const existingMap = new Map(existing.map((p) => [p.type, p]));

    return PREFERENCE_CATEGORIES.map((category) => {
      const types = CATEGORY_NOTIFICATION_TYPES[category];
      const channelEmail = types.some((t) => existingMap.get(t)?.emailEnabled ?? true);
      const channelPush = types.some((t) => existingMap.get(t)?.pushEnabled ?? true);
      return { category, channelEmail, channelPush };
    });
  }

  // GET /notification-preferences — настройки текущего пользователя в category-форме.
  app.get('/notification-preferences', async (request) => {
    const userId = request.user!.userId;
    const preferences = await readCategoryPreferences(userId);
    return { preferences };
  });

  // PATCH /notification-preferences — обновление настроек.
  // Тело: { preferences: [{ category, channelEmail?, channelPush? }] } — category-форма
  // фронта. Валидация формы — ВРУЧНУЮ (без глобальных compiler'ов, чтобы не задеть
  // сериализацию других роутов, инцидент 2026-06-18). Категория раскрывается в свои
  // NotificationType[]: переданный флаг канала пишется во ВСЕ типы категории
  // (upsert по userId_type). Возвращает ту же category-форму.
  app.patch('/notification-preferences', async (request, reply) => {
    const userId = request.user!.userId;
    const body = request.body as { preferences?: unknown } | null;

    const preferences = body?.preferences;
    if (!Array.isArray(preferences)) {
      return reply
        .status(400)
        .send({ error: 'Тело запроса должно быть { preferences: [...] }' });
    }

    type Item = { category: PreferenceCategory; channelEmail?: boolean; channelPush?: boolean };
    const items: Item[] = [];

    for (const raw of preferences) {
      if (typeof raw !== 'object' || raw === null) {
        return reply.status(400).send({ error: 'Каждая настройка должна быть объектом' });
      }
      const item = raw as Record<string, unknown>;
      const category = item.category;
      if (typeof category !== 'string' || !(category in CATEGORY_NOTIFICATION_TYPES)) {
        return reply.status(400).send({ error: `Неизвестная категория: ${String(category)}` });
      }
      if (item.channelEmail !== undefined && typeof item.channelEmail !== 'boolean') {
        return reply.status(400).send({ error: 'channelEmail должно быть булевым' });
      }
      if (item.channelPush !== undefined && typeof item.channelPush !== 'boolean') {
        return reply.status(400).send({ error: 'channelPush должно быть булевым' });
      }
      items.push({
        category: category as PreferenceCategory,
        channelEmail: item.channelEmail as boolean | undefined,
        channelPush: item.channelPush as boolean | undefined,
      });
    }

    // Раскрываем каждую категорию в её типы и апсертим флаг канала во все типы.
    const upserts: Array<{ type: NotificationType; channelEmail?: boolean; channelPush?: boolean }> = [];
    for (const item of items) {
      for (const type of CATEGORY_NOTIFICATION_TYPES[item.category]) {
        upserts.push({ type, channelEmail: item.channelEmail, channelPush: item.channelPush });
      }
    }

    await Promise.all(
      upserts.map((u) =>
        prisma.notificationPreference.upsert({
          where: { userId_type: { userId, type: u.type } },
          create: {
            userId,
            type: u.type,
            emailEnabled: u.channelEmail ?? true,
            pushEnabled: u.channelPush ?? true,
            inAppEnabled: true,
          },
          update: {
            ...(u.channelEmail !== undefined ? { emailEnabled: u.channelEmail } : {}),
            ...(u.channelPush !== undefined ? { pushEnabled: u.channelPush } : {}),
          },
        }),
      ),
    );

    const result = await readCategoryPreferences(userId);
    return { preferences: result };
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
