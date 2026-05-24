-- Анти-спам на уровне БД (M1, эпик «Оплата и баланс»): ровно ОДНА заявка на пополнение
-- в статусе 'pending' на пользователя. Раньше инвариант держался ТОЛЬКО приложением
-- (findFirst по {userId,status:'pending'} → 409 в apps/api/src/routes/payments.ts) — это
-- TOCTOU-гонка: два параллельных запроса могли создать две pending-заявки. Закрываем на БД
-- частичным уникальным индексом (Prisma не умеет partial unique в schema → сырой SQL, как у
-- "charge_active_uniq" в 20260629_group_payment_plan).
--
-- АДДИТИВНОСТЬ: миграция не меняет структуру таблицы (нет ADD/DROP COLUMN), не трогает
-- другие таблицы. Forward-only, без долгих локов (таблица небольшая). CONCURRENTLY НЕ
-- используется намеренно — его нельзя выполнять внутри транзакции `prisma migrate deploy`.
--
-- ДАННЫЕ / БЕЗОПАСНОСТЬ ДЕПЛОЯ: на проде ТЕОРЕТИЧЕСКИ могут оказаться дубли pending у одного
-- пользователя (приложение их не плодило, но без БД-гарантии исключать нельзя). Создание
-- UNIQUE-индекса при наличии дублей УПАЛО БЫ и сломало бы авто-деплой. Поэтому СНАЧАЛА
-- разрубаем дубли, ПОТОМ строим индекс.

-- Шаг 1. Дедуп: для каждого userId с >1 pending оставляем самую свежую (по createdAt) заявку,
-- остальные переводим в 'rejected' с reviewedAt = now() (это и есть желаемый инвариант —
-- лишние дубликаты пользователю не нужны). Один UPDATE через оконную функцию ROW_NUMBER().
UPDATE "TopUpRequest" AS t
SET "status" = 'rejected',
    "reviewedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
    SELECT "id",
           ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC, "id" DESC) AS rn
    FROM "TopUpRequest"
    WHERE "status" = 'pending'
) AS ranked
WHERE t."id" = ranked."id"
  AND ranked.rn > 1;

-- Шаг 2. Частичный уникальный индекс: одна pending-заявка на пользователя. Обычный (не
-- CONCURRENTLY) индекс — таблица небольшая, лок короткий.
CREATE UNIQUE INDEX "TopUpRequest_userId_pending_key"
    ON "TopUpRequest"("userId")
    WHERE "status" = 'pending';
