-- Таймауты состояний «формируется vs ошибка» для записи и итогов. Строго аддитивная
-- миграция: только две новые nullable-колонки на Session. Бэкофилла нет, существующие
-- данные не трогаются, долгих локов не возникает (ADD COLUMN без DEFAULT/NOT NULL —
-- метаданные, мгновенно).
--
-- recordingRequestedAt — момент, когда запись запрошена/ожидается (ставится на
--   meeting.ended); нужен для таймаута «формируется → недоступно». summaryRequestedAt —
--   аналогично для итогов (на meeting.ended): таймаут состояния итогов. Парный к уже
--   существующему transcriptRequestedAt.
ALTER TABLE "Session" ADD COLUMN     "recordingRequestedAt" TIMESTAMP(3),
ADD COLUMN     "summaryRequestedAt" TIMESTAMP(3);
