-- Zoom-созвоны, Волна 2. Строго аддитивная миграция: только новые nullable-колонки,
-- новая таблица и индексы. Бэкофилла нет, существующие данные не трогаются, долгих
-- локов не возникает (ADD COLUMN без DEFAULT/NOT NULL — метаданные, мгновенно).

-- 1. Поля Zoom на занятии потока (Session). Все nullable.
--    Session.summary — итоги КОНКРЕТНОГО занятия потока, отдельно от Lesson.summary.
ALTER TABLE "Session" ADD COLUMN     "zoomMeetingId" TEXT,
ADD COLUMN     "recordingStatus" TEXT,
ADD COLUMN     "recordingError" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summarySource" TEXT;

-- 2. Поля интеграции Zoom (ZoomIntegration). Все nullable.
--    secretTokenEnc — Webhook Secret Token (шифруется как clientSecretEnc).
--    webhookId — публичный неугадываемый id для персонального URL вебхука; заполняется приложением позже.
ALTER TABLE "ZoomIntegration" ADD COLUMN     "secretTokenEnc" TEXT,
ADD COLUMN     "webhookId" TEXT;

-- 3. Журнал входящих вебхуков Zoom для идемпотентной обработки.
CREATE TABLE "ZoomWebhookEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ZoomWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- 4. Индексы.
CREATE UNIQUE INDEX "ZoomWebhookEvent_dedupeKey_key" ON "ZoomWebhookEvent"("dedupeKey");
CREATE INDEX "Session_zoomMeetingId_idx" ON "Session"("zoomMeetingId");
CREATE UNIQUE INDEX "ZoomIntegration_webhookId_key" ON "ZoomIntegration"("webhookId");
