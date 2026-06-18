-- Новое значение meetingRecording в enum ConsentType — фиксация согласия пользователя
-- на запись/транскрибацию созвонов (эпик «Встречи 1-на-1», #154). Привязано к документу
-- meeting-recording-consent. РАЗОВОЕ согласие (не входит в REQUIRED_CONSENT_TYPES, вход
-- не блокирует). СТРОГО АДДИТИВНАЯ, forward-only: только расширяем перечень значений,
-- существующие значения/данные/таблицы не трогаем.
--
-- ТРАНЗАКЦИОННОСТЬ: ALTER TYPE ... ADD VALUE — операция над метаданными, без долгих
-- локов. Новое значение НЕ используется в этой же миграции (ни в DDL, ни в DML),
-- поэтому выполнение внутри транзакции `prisma migrate deploy` безопасно (PG 12+) —
-- та же схема, что в 20260714_consent_personal_data_policy. Размещаем в конце enum
-- ConsentType.

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'meetingRecording';
