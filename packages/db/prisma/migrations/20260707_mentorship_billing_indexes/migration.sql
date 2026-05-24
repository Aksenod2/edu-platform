-- Индексы под фичу «ежемесячное авто-списание за менторские группы». АДДИТИВНАЯ по данным
-- (строки не трогаются), forward-only. Частичные уникальные индексы делаются СЫРЫМ SQL —
-- Prisma не умеет partial unique в schema (как "charge_active_uniq" в 20260629_group_payment_plan
-- и "TopUpRequest_userId_pending_key" в 20260704_topup_pending_unique).
--
-- ЗАЧЕМ ПЕРЕСОБИРАЕМ charge_active_uniq. Старый индекс (из 20260629_group_payment_plan):
--   CREATE UNIQUE INDEX "charge_active_uniq" ON "Charge"("streamId","userId") WHERE "status" = 'open';
-- В месячной модели он бы КОНФЛИКТОВАЛ: открытый долг прошлого месяца заблокировал бы создание
-- начисления за новый период (та же пара streamId+userId). Поэтому:
--   1) сужаем "charge_active_uniq" до РАЗОВЫХ начислений (periodKey IS NULL) — для них инвариант
--      «одно открытое на пару» сохраняется как раньше;
--   2) добавляем "charge_period_uniq" — одно МЕСЯЧНОЕ начисление на (streamId,userId,periodKey).
--
-- БЕЗОПАСНОСТЬ ПЕРЕСБОРКИ. На момент этой миграции колонка Charge.periodKey только что добавлена
-- (20260706) и у ВСЕХ существующих строк = NULL. Значит:
--   * новый "charge_active_uniq" (... WHERE status='open' AND periodKey IS NULL) покрывает РОВНО
--     те же строки, что и старый (... WHERE status='open') — множество строк в индексе идентично,
--     новых дублей не появляется, индекс построится без ошибки;
--   * "charge_period_uniq" (WHERE periodKey IS NOT NULL) на старте пуст — строится мгновенно.
-- Обычные (не CONCURRENTLY) индексы: CONCURRENTLY нельзя внутри транзакции migrate deploy; таблица
-- Charge небольшая, лок короткий.

-- Пересобираем charge_active_uniq: сужаем до разовых начислений (periodKey IS NULL).
DROP INDEX "charge_active_uniq";
CREATE UNIQUE INDEX "charge_active_uniq" ON "Charge"("streamId", "userId") WHERE "status" = 'open' AND "periodKey" IS NULL;

-- Идемпотентность месячных начислений: одно начисление на (группа, студент, период).
CREATE UNIQUE INDEX "charge_period_uniq" ON "Charge"("streamId", "userId", "periodKey") WHERE "periodKey" IS NOT NULL;

-- Индекс под выборку групп по типу биллинга (cron перебирает monthly-группы).
CREATE INDEX "Stream_billingType_idx" ON "Stream"("billingType");
