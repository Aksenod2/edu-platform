-- Фаза 1 эпика «Оплата и баланс»: заявки на пополнение по скрину + настройки оплаты.
-- Строго аддитивная миграция: только новый enum, новые таблицы, индексы и FK.
-- Бэкофилла нет, существующие данные/таблицы не трогаются. Долгих локов не возникает:
-- CREATE TABLE/TYPE/INDEX по новым объектам и FK на новую таблицу — без переписывания
-- существующих строк. Relation-поля, добавленные в модели User и WalletTransaction
-- (topUpRequests/reviewedTopUps/topUpRequest), виртуальные — колонок не создают.

-- 1. Статус заявки на пополнение.
CREATE TYPE "TopUpRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- 2. Заявка студента на пополнение по скриншоту оплаты.
--    walletTransactionId UNIQUE — идемпотентность: одна заявка → не более одной транзакции пополнения.
CREATE TABLE "TopUpRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screenshotKey" TEXT NOT NULL,
    "claimedAmountKopecks" INTEGER,
    "status" "TopUpRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "walletTransactionId" TEXT,
    "creditedAmountKopecks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpRequest_pkey" PRIMARY KEY ("id")
);

-- 3. Настройки оплаты (синглтон — один ряд с id='singleton').
CREATE TABLE "PaymentSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "transferUrl" TEXT,
    "transferPhone" TEXT,
    "qrFileKey" TEXT,
    "instructions" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("id")
);

-- 4. Индексы.
CREATE UNIQUE INDEX "TopUpRequest_walletTransactionId_key" ON "TopUpRequest"("walletTransactionId");
CREATE INDEX "TopUpRequest_status_idx" ON "TopUpRequest"("status");
CREATE INDEX "TopUpRequest_userId_idx" ON "TopUpRequest"("userId");

-- 5. Внешние ключи (на User и WalletTransaction).
ALTER TABLE "TopUpRequest" ADD CONSTRAINT "TopUpRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopUpRequest" ADD CONSTRAINT "TopUpRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopUpRequest" ADD CONSTRAINT "TopUpRequest_walletTransactionId_fkey" FOREIGN KEY ("walletTransactionId") REFERENCES "WalletTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
