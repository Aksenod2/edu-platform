-- Push-напоминания о предстоящих событиях (занятие/встреча), эпик #169.
-- СТРОГО АДДИТИВНАЯ, forward-only миграция: добавляется ОДНА новая таблица
-- EventReminderSent (с индексами и FK на User) + ДВА значения в существующий enum
-- NotificationType. Существующие таблицы/колонки/данные НЕ трогаются, бэкофилла нет.
--
-- АДДИТИВНОСТЬ/БЕЗОПАСНОСТЬ на живом проде (`prisma migrate deploy` из main):
--   * CREATE TABLE — операция над метаданными, новая пустая таблица, без долгих локов
--     и без блокировок чтения/записи по существующим таблицам.
--   * ALTER TYPE ... ADD VALUE — операция над метаданными enum, без трогания строк.
--     Новые значения в этой же миграции НЕ используются (нет дефолтов/CHECK с ними),
--     поэтому ADD VALUE безопасен в транзакции `migrate deploy` (PostgreSQL 12+).
--     Размещаем в конце enum. Как в 20260705_mentorship_billing_enums /
--     20260714_notif_student_enrolled.
--
-- EventReminderSent — метка об уже отправленном push-напоминании = механизм
--   идемпотентности планировщика. Один ряд на (eventType, eventId, offsetMinutes, userId):
--   тик cron ПЕРЕД отправкой создаёт ряд, гонка/двойной тик ловится unique-индексом
--   (P2002 → пропуск).
--     eventType     — тип события строкой: 'session' | 'meeting' (полиморфизм, БЕЗ enum);
--     eventId       — id Session или Meeting (БЕЗ FK на событие — намеренно, полиморфизм);
--     offsetMinutes — оффсет напоминания: 60 | 15;
--     userId        — получатель (препод/студент);
--     sentAt        — момент отправки (диагностика/ретеншн-чистка сирот).
--   onDelete: userId → Cascade (метки чистятся при удалении пользователя). Осиротевшие
--   после удаления Session/Meeting метки безвредны (idempotency-журнал) и подчищаются
--   ретеншн-свипером.

-- CreateTable: метки об отправленных push-напоминаниях о событиях (идемпотентность)
CREATE TABLE "EventReminderSent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminderSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: идемпотентность — одно напоминание на (тип, событие, оффсет, пользователь)
CREATE UNIQUE INDEX "EventReminderSent_eventType_eventId_offsetMinutes_userId_key" ON "EventReminderSent"("eventType", "eventId", "offsetMinutes", "userId");

-- CreateIndex: быстрый deleteMany при переносе события (сброс меток «отправлено»)
CREATE INDEX "EventReminderSent_eventId_eventType_idx" ON "EventReminderSent"("eventId", "eventType");

-- AddForeignKey: EventReminderSent.userId → User (удаление пользователя каскадит метки)
ALTER TABLE "EventReminderSent" ADD CONSTRAINT "EventReminderSent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum: два значения для двух независимых тумблеров напоминаний (за 1 час / 15 минут).
-- Размещаем в конце enum NotificationType. Тип уже существует — меняем только перечень
-- значений, существующие данные/таблицы не трогаем. Значения в этой миграции не используются.
ALTER TYPE "NotificationType" ADD VALUE 'event_reminder_60';
ALTER TYPE "NotificationType" ADD VALUE 'event_reminder_15';
