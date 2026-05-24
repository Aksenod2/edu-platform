-- Платёжный план группы (эпик «Оплата и баланс»). СТРОГО АДДИТИВНАЯ, forward-only
-- миграция: новый enum, новая таблица Charge (ledger начислений студенту за группу) и
-- две новые nullable-колонки (Stream.priceKopecks, WalletTransaction.chargeId). БЭКОФИЛЛА НЕТ:
-- существующие строки не трогаются, ADD COLUMN без DEFAULT/NOT NULL — операция над метаданными
-- (мгновенно, без долгих локов), безопасно для `prisma migrate deploy` на живом проде.
--
-- Stream.priceKopecks: цена участия (копейки), null = план не задан (без автоначисления).
-- WalletTransaction.chargeId: какое начисление гасится этой транзакцией (одно начисление может
--   гаситься несколькими списаниями — поэтому связь со стороны WalletTransaction, НЕ @unique).
-- Charge: amountKopecks — цена, зафиксированная на момент зачисления; paidKopecks — погашено;
--   status open/paid/refunded; createdById — админ-создатель (для аудита/возврата).

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('open', 'paid', 'refunded');

-- AlterTable: платёжный план группы (nullable, без default)
ALTER TABLE "Stream" ADD COLUMN     "priceKopecks" INTEGER;

-- AlterTable: связь списания с начислением (nullable)
ALTER TABLE "WalletTransaction" ADD COLUMN     "chargeId" TEXT;

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountKopecks" INTEGER NOT NULL,
    "paidKopecks" INTEGER NOT NULL DEFAULT 0,
    "status" "ChargeStatus" NOT NULL DEFAULT 'open',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Charge_userId_status_idx" ON "Charge"("userId", "status");

-- CreateIndex
CREATE INDEX "Charge_streamId_idx" ON "Charge"("streamId");

-- CreateIndex
CREATE INDEX "WalletTransaction_chargeId_idx" ON "WalletTransaction"("chargeId");

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PARTIAL UNIQUE INDEX (вручную; Prisma не умеет partial unique в schema).
-- Идемпотентность: ровно одно ОТКРЫТОЕ начисление на пару (студент, группа). После
-- полного погашения (status != 'open') можно создать новое начисление.
CREATE UNIQUE INDEX "charge_active_uniq" ON "Charge"("streamId", "userId") WHERE "status" = 'open';
