-- Новые колонки для фичи «ежемесячное авто-списание за менторские группы» + флаг демо-аккаунта.
-- СТРОГО АДДИТИВНАЯ, forward-only, БЕЗ БЭКОФИЛЛА. Все ADD COLUMN:
--   * nullable без default (Stream.monthlyPriceKopecks, Stream.billingDayOfMonth, Charge.periodKey)
--     — операция над метаданными, мгновенно, без долгих локов;
--   * NOT NULL DEFAULT <константа> (Stream.billingType, Charge.kind, User.isDemo) — в PostgreSQL 11+
--     это тоже операция над метаданными (default не материализуется в существующие строки на месте,
--     возвращается виртуально) — мгновенно, без переписывания таблицы, без долгих локов.
-- Существующие строки получают безопасные значения по умолчанию (разовая оплата / разовое
-- начисление / не демо) — поведение не меняется. Безопасно для авто-`prisma migrate deploy` на проде.

-- AlterTable Stream: тип биллинга + параметры месячного авто-списания.
ALTER TABLE "Stream" ADD COLUMN     "billingType" "StreamBillingType" NOT NULL DEFAULT 'one_time';
ALTER TABLE "Stream" ADD COLUMN     "monthlyPriceKopecks" INTEGER;
ALTER TABLE "Stream" ADD COLUMN     "billingDayOfMonth" INTEGER;

-- AlterTable Charge: период месячного начисления ('YYYY-MM', null = разовое) + тип начисления.
ALTER TABLE "Charge" ADD COLUMN     "periodKey" TEXT;
ALTER TABLE "Charge" ADD COLUMN     "kind" "ChargeKind" NOT NULL DEFAULT 'one_time';

-- AlterTable User: единый флаг демо/служебного аккаунта (не списывать + скрыть из статистики).
ALTER TABLE "User" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;
