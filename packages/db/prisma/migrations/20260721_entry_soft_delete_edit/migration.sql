-- Добавляет deletedAt (мягкое удаление) и editedAt (метка редактирования)
-- в сообщения чатов (ConversationEntry).
ALTER TABLE "ConversationEntry"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "editedAt"  TIMESTAMP(3);
