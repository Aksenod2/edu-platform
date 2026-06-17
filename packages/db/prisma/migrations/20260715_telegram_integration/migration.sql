-- Эпик «Уведомления преподавателю», задача 1: схема под персональную интеграцию
-- с Telegram-ботом. Каждый преподаватель вводит токен СВОЕГО бота (как Zoom-секреты).
-- СТРОГО АДДИТИВНАЯ, forward-only. Ничего не удаляем, существующие данные не трогаем.
--
-- 1) Новая таблица TelegramIntegration (per-user токен бота + привязанный chatId).
-- 2) Новая колонка NotificationPreference.telegramEnabled с дефолтом true.
--
-- АДДИТИВНОСТЬ/БЕЗОПАСНОСТЬ:
--  - CREATE TABLE и CREATE INDEX по новой таблице — без локов на существующих таблицах.
--  - ADD COLUMN ... DEFAULT true в PostgreSQL 11+ не переписывает таблицу (метаданные),
--    т.е. без долгого ACCESS EXCLUSIVE лока и без бэкофилла строк. Существующие строки
--    NotificationPreference получат telegramEnabled = true автоматически.
--  - FK на User добавляется на пустую новую таблицу — валидация мгновенная.

-- CreateTable
CREATE TABLE "TelegramIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "botTokenEnc" TEXT,
    "botUsername" TEXT,
    "chatId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: одна интеграция на пользователя.
CREATE UNIQUE INDEX "TelegramIntegration_userId_key" ON "TelegramIntegration"("userId");

-- AddForeignKey: каскадное удаление вместе с пользователем.
ALTER TABLE "TelegramIntegration" ADD CONSTRAINT "TelegramIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: новый канал уведомлений Telegram в настройках. Дефолт true безопасен —
-- отправка реальна только когда у пользователя задан токен бота и привязан chatId.
ALTER TABLE "NotificationPreference" ADD COLUMN "telegramEnabled" BOOLEAN NOT NULL DEFAULT true;
