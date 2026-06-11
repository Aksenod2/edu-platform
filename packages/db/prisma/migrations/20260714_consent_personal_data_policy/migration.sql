-- Новое значение personalDataPolicy в enum ConsentType — фиксация ознакомления
-- пользователя с «Политикой обработки персональных данных» (документ
-- personal-data-policy, issue #130). СТРОГО АДДИТИВНАЯ, forward-only: только
-- расширяем перечень значений, существующие значения/данные/таблицы не трогаем.
--
-- ТРАНЗАКЦИОННОСТЬ: ALTER TYPE ... ADD VALUE — операция над метаданными, без долгих
-- локов. Новое значение НЕ используется в этой же миграции (ни в DDL, ни в DML),
-- поэтому выполнение внутри транзакции `prisma migrate deploy` безопасно (PG 12+) —
-- та же схема, что в 20260701_notif_topup_requested и 20260705_mentorship_billing_enums.
-- Размещаем в конце enum ConsentType.

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'personalDataPolicy';
