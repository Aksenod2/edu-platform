-- Новые enum-типы для фичи «ежемесячное авто-списание за менторские группы» +
-- два значения в существующий enum NotificationType. СТРОГО АДДИТИВНАЯ, forward-only.
-- Здесь ТОЛЬКО объявляем типы/значения; в колонках они НЕ используются (использование —
-- в следующей миграции 20260706). Разнесение «создание типа» и «использование в колонке»
-- по разным миграциям сделано намеренно — для чистоты и упрощения отката (как в проекте
-- принято для enum-значений, см. 20260701_notif_topup_requested).
--
-- АДДИТИВНОСТЬ/БЕЗОПАСНОСТЬ: CREATE TYPE и ALTER TYPE ... ADD VALUE — операции над
-- метаданными, без долгих локов и без трогания данных. ADD VALUE не используется в той же
-- миграции, где он добавлен, поэтому безопасен в транзакции `prisma migrate deploy` (PG 12+).

-- CreateEnum: тип биллинга группы (разовая / месячная).
CREATE TYPE "StreamBillingType" AS ENUM ('one_time', 'monthly');

-- CreateEnum: тип начисления (разовое / ежемесячное менторское).
CREATE TYPE "ChargeKind" AS ENUM ('one_time', 'monthly');

-- AlterEnum: уведомления о предстоящем менторском списании и о возникшем долге.
-- Размещаем в конце enum NotificationType. Тип уже существует — меняем только перечень
-- значений, существующие данные/таблицы не трогаем.
ALTER TYPE "NotificationType" ADD VALUE 'mentorship_charge_upcoming';
ALTER TYPE "NotificationType" ADD VALUE 'mentorship_charge_debt';
