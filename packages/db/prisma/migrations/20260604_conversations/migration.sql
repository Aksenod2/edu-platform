-- Обобщение модели сообщений: Thread -> Conversation (student | staff | stream).
-- Переименования сохраняют данные живой переписки; новые объекты добавляются аддитивно.

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('student', 'staff', 'stream');

-- Rename Thread -> Conversation (данные сохраняются)
ALTER TABLE "Thread" RENAME TO "Conversation";
ALTER TABLE "Conversation" RENAME CONSTRAINT "Thread_pkey" TO "Conversation_pkey";
ALTER INDEX "Thread_studentId_key" RENAME TO "Conversation_studentId_key";
ALTER TABLE "Conversation" RENAME CONSTRAINT "Thread_studentId_fkey" TO "Conversation_studentId_fkey";

-- Rename ThreadEntry -> ConversationEntry (данные сохраняются)
ALTER TABLE "ThreadEntry" RENAME TO "ConversationEntry";
ALTER TABLE "ConversationEntry" RENAME COLUMN "threadId" TO "conversationId";
ALTER TABLE "ConversationEntry" RENAME CONSTRAINT "ThreadEntry_pkey" TO "ConversationEntry_pkey";
ALTER INDEX "ThreadEntry_threadId_idx" RENAME TO "ConversationEntry_conversationId_idx";
ALTER INDEX "ThreadEntry_authorId_idx" RENAME TO "ConversationEntry_authorId_idx";
ALTER TABLE "ConversationEntry" RENAME CONSTRAINT "ThreadEntry_threadId_fkey" TO "ConversationEntry_conversationId_fkey";
ALTER TABLE "ConversationEntry" RENAME CONSTRAINT "ThreadEntry_authorId_fkey" TO "ConversationEntry_authorId_fkey";
ALTER TABLE "ConversationEntry" RENAME CONSTRAINT "ThreadEntry_assignmentId_fkey" TO "ConversationEntry_assignmentId_fkey";

-- Conversation: новые поля (существующие строки = студенческие треды)
ALTER TABLE "Conversation" ADD COLUMN "type" "ConversationType" NOT NULL DEFAULT 'student';
ALTER TABLE "Conversation" ADD COLUMN "streamId" TEXT;
ALTER TABLE "Conversation" ALTER COLUMN "studentId" DROP NOT NULL;
ALTER TABLE "Conversation" ALTER COLUMN "type" DROP DEFAULT;

-- Conversation.streamId: уникальность + связь с потоком
CREATE UNIQUE INDEX "Conversation_streamId_key" ON "Conversation"("streamId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ConversationRead: пер-участниковая отметка прочтения для групповых чатов
CREATE TABLE "ConversationRead" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConversationRead_conversationId_userId_key" ON "ConversationRead"("conversationId", "userId");
CREATE INDEX "ConversationRead_userId_idx" ON "ConversationRead"("userId");
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Единый штаб-канал преподавателей
INSERT INTO "Conversation" ("id", "type", "createdAt") VALUES (gen_random_uuid()::text, 'staff', CURRENT_TIMESTAMP);
