-- Итоги + Транскрипт занятия (Ф1.2 + Ф2.6). Строго аддитивная миграция: только новые
-- nullable-колонки на Session. Бэкофилла нет, существующие данные не трогаются, долгих
-- локов не возникает (ADD COLUMN без DEFAULT/NOT NULL — метаданные, мгновенно).
--
-- summaryStatus/transcriptStatus — статусы строкой без enum (по конвенции проекта,
--   ср. Session.recordingStatus). transcriptVttKey/transcriptTxtKey — ключи S3 для
--   сырого .vtt и очищенного .txt. transcriptError — текст ошибки забора (для UI
--   препода/админа). transcriptRequestedAt — момент запроса транскрипта (нужен для
--   увеличенного таймаута до failed: транскрипт приходит из Zoom позже записи).
ALTER TABLE "Session" ADD COLUMN     "summaryStatus" TEXT,
ADD COLUMN     "transcriptStatus" TEXT,
ADD COLUMN     "transcriptVttKey" TEXT,
ADD COLUMN     "transcriptTxtKey" TEXT,
ADD COLUMN     "transcriptError" TEXT,
ADD COLUMN     "transcriptRequestedAt" TIMESTAMP(3);
