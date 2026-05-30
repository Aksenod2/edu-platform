-- Внешняя ссылка на оплату группы (Stream.paymentUrl).
-- СТРОГО АДДИТИВНАЯ, forward-only миграция: добавляется ОДНА nullable-колонка.
-- Существующие данные/колонки НЕ трогаются, бэкофилла нет, долгих локов нет —
-- безопасно для `prisma migrate deploy` на живом проде (авто-деплой из main).
ALTER TABLE "Stream" ADD COLUMN "paymentUrl" TEXT;
