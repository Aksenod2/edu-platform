// Единый источник правды контракта настроек уведомлений (матрица «категория × канал»).
//
// Зачем: исторически фронт и бэк описывали этот контракт В ДВУХ МЕСТАХ и
// разошлись (issue #172): фронт слал `{ preferences: [{ category, channelEmail,
// channelPush }] }`, а бэк ждал ГОЛЫЙ массив `[{ type, emailEnabled, ... }]` →
// 400 «Тело запроса должно быть массивом настроек». Здесь — ОДНА схема, из
// которой и фронт (через `z.infer`), и бэк (через `.parse` + validatorCompiler)
// берут форму запроса/ответа. Несовпадение теперь = ошибка компиляции/теста.
//
// Продуктовая модель — КАТЕГОРИИ (то, что видит пользователь в матрице).
// Внутренняя модель хранения — `NotificationType` (per-type строки
// `NotificationPreference`, их читает `lib/notifications.ts` при отправке).
// Карта `CATEGORY_NOTIFICATION_TYPES` раскрывает категорию в её типы: бэк при
// сохранении пишет ОДИН флаг канала во ВСЕ типы категории, при чтении —
// сворачивает типы обратно в категорию. Карта общая → фронт и бэк не разъедутся.

import { z } from 'zod';

/**
 * Настраиваемые пользователем КАТЕГОРИИ уведомлений (продуктовая модель — строки
 * матрицы). `system` НЕ настраивается (приглашения, сброс пароля — всегда вкл),
 * поэтому в схему запроса не входит и в карту типов ниже не включён.
 */
export const NOTIFICATION_CATEGORIES = [
  'learning',
  'deadlines',
  'feedback',
  'schedule',
  'student_activity',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Карта «категория → её внутренние NotificationType». ЕДИНЫЙ источник связи
 * продуктовой модели (категории) и модели хранения (типы). Значения строк —
 * литералы NotificationType из Prisma-схемы (packages/db). Бэк раскрывает
 * категорию в эти типы при upsert и сворачивает обратно при чтении.
 *
 * НЕ входят сюда (управляются иначе, не матрицей):
 *  - `system`-события (invite/reset) — некатегорируемы, всегда включены;
 *  - `event_reminder_60` / `event_reminder_15` — отдельный узкий эндпоинт
 *    `/event-reminder-preferences` (только push-канал, issue #169);
 *  - `topup_requested`, `mentorship_charge_*` — служебные, в матрицу не входят.
 */
export const CATEGORY_NOTIFICATION_TYPES = {
  learning: ['lesson_published', 'assignment_created'],
  deadlines: ['deadline_reminder'],
  feedback: ['assignment_reviewed', 'thread_entry'],
  schedule: ['schedule_entry_created'],
  student_activity: ['assignment_submitted', 'student_enrolled'],
} as const satisfies Record<NotificationCategory, readonly string[]>;

/** Плоский список всех NotificationType, относящихся к матрице категорий. */
export const MATRIX_NOTIFICATION_TYPES = Object.values(
  CATEGORY_NOTIFICATION_TYPES,
).flat();

// ── Схемы запроса/ответа ─────────────────────────────────────────────────────

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

/** Одна строка настроек категории на проводе (и в запросе PATCH, и в ответе). */
export const notificationPreferenceSchema = z.object({
  category: notificationCategorySchema,
  channelEmail: z.boolean(),
  channelPush: z.boolean(),
});

export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

/**
 * Тело PATCH /notification-preferences. Обёртка `{ preferences: [...] }` —
 * совместима с тем, что УЖЕ шлёт фронт (исправляем рассинхрон формы, не ломая
 * клиента). Каналы в запросе опциональны: переданное — применяем, остальное
 * не трогаем (частичное обновление).
 */
export const updateNotificationPreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: notificationCategorySchema,
        channelEmail: z.boolean().optional(),
        channelPush: z.boolean().optional(),
      }),
    )
    .min(1, 'Нужна хотя бы одна категория настроек'),
});

export type UpdateNotificationPreferencesBody = z.infer<
  typeof updateNotificationPreferencesSchema
>;

/** Ответ GET и PATCH /notification-preferences. */
export const notificationPreferencesResponseSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
});

export type NotificationPreferencesResponse = z.infer<
  typeof notificationPreferencesResponseSchema
>;
