-- Общий чат потока: новый тип канала 'cohort' (студенты потока + преподаватели),
-- сосуществует с преподским чатом потока (type='stream') на том же streamId.

-- Новое значение enum. ADD VALUE не используется в этой же миграции,
-- поэтому безопасно в транзакции (PostgreSQL 12+).
ALTER TYPE "ConversationType" ADD VALUE 'cohort';

-- Снимаем старую уникальность по одному streamId (был один канал на поток)
-- и вводим составную уникальность (type, streamId): на один streamId теперь
-- допустимы и stream-, и cohort-канал.
DROP INDEX "Conversation_streamId_key";
CREATE UNIQUE INDEX "Conversation_type_streamId_key" ON "Conversation"("type", "streamId");
