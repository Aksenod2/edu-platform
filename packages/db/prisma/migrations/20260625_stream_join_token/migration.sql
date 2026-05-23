-- Инвайт-ссылка в поток: публичный токен постоянной ссылки вступления.
-- Строго аддитивная миграция: две nullable-колонки на Stream + уникальный индекс.
-- Бэкофилла нет, существующие данные/таблицы не трогаются. ADD COLUMN nullable не
-- переписывает строки и не берёт долгих локов; уникальный индекс по новой (пустой)
-- колонке строится без конфликтов. joinToken — это НЕ User.inviteToken (другой механизм).

ALTER TABLE "Stream" ADD COLUMN "joinToken" TEXT;
ALTER TABLE "Stream" ADD COLUMN "joinTokenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Stream_joinToken_key" ON "Stream"("joinToken");
