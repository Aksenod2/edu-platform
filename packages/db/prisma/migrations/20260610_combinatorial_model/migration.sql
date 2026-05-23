-- Комбинаторная модель: Lesson становится переиспользуемым блоком, появляются
-- Program (программа) и Session (проведение урока в потоке). Поля задания
-- сворачиваются в сам Lesson (отдельной таблицы Assignment больше нет).
-- Прод-данные — тестовые/демо, поэтому переносы данных не делаем.

-- 1. Новый тип программы
CREATE TYPE "ProgramType" AS ENUM ('course', 'intensive', 'mentorship');

-- 2. LessonStatus -> SessionStatus (статус теперь у проведения, а не у урока)
ALTER TYPE "LessonStatus" RENAME TO "SessionStatus";

-- 3. Program — переиспользуемая программа (набор уроков)
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProgramType" NOT NULL DEFAULT 'course',
    "ownerId" TEXT,
    "whatYouLearn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Program_ownerId_idx" ON "Program"("ownerId");
ALTER TABLE "Program" ADD CONSTRAINT "Program_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. ProgramLesson — состав программы (уроки в порядке)
CREATE TABLE "ProgramLesson" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramLesson_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProgramLesson_programId_lessonId_key" ON "ProgramLesson"("programId", "lessonId");
CREATE INDEX "ProgramLesson_programId_idx" ON "ProgramLesson"("programId");
CREATE INDEX "ProgramLesson_lessonId_idx" ON "ProgramLesson"("lessonId");
ALTER TABLE "ProgramLesson" ADD CONSTRAINT "ProgramLesson_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramLesson" ADD CONSTRAINT "ProgramLesson_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Session — проведение урока в конкретном потоке (расписание + статус)
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'planned',
    "date" DATE,
    "startTime" TEXT,
    "meetingUrl" TEXT,
    "videoUrl" TEXT,
    "videoKey" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_streamId_lessonId_key" ON "Session"("streamId", "lessonId");
CREATE INDEX "Session_streamId_idx" ON "Session"("streamId");
CREATE INDEX "Session_lessonId_idx" ON "Session"("lessonId");
CREATE INDEX "Session_status_date_idx" ON "Session"("status", "date");
ALTER TABLE "Session" ADD CONSTRAINT "Session_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Stream привязывается к программе
ALTER TABLE "Stream" ADD COLUMN "programId" TEXT;
CREATE INDEX "Stream_programId_idx" ON "Stream"("programId");
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Lesson становится переиспользуемым блоком: убираем привязку к потоку и
--    расписание (переехало в Session), вносим свёрнутые поля задания
ALTER TABLE "Lesson" ADD COLUMN "hasAssignment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lesson" ADD COLUMN "assignmentTitle" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "assignmentDescription" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "assignmentCriteria" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "assignmentType" "AssignmentType";
ALTER TABLE "Lesson" ADD COLUMN "assignmentTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Lesson" ADD COLUMN "assignmentMaterials" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "Lesson" DROP CONSTRAINT "Lesson_streamId_fkey";
DROP INDEX "Lesson_streamId_idx";
ALTER TABLE "Lesson" DROP COLUMN "streamId";
ALTER TABLE "Lesson" DROP COLUMN "status";
ALTER TABLE "Lesson" DROP COLUMN "date";
ALTER TABLE "Lesson" DROP COLUMN "startTime";
ALTER TABLE "Lesson" DROP COLUMN "meetingUrl";

-- 8. StudentAssignment теперь ключуется по Session (а не по Assignment).
--    Данные — демо, поэтому таблицу пересоздаём.
DROP TABLE "StudentAssignment";
CREATE TABLE "StudentAssignment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "StudentAssignmentStatus" NOT NULL DEFAULT 'assigned',
    "content" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "studentComment" TEXT,
    "reviewText" TEXT,
    "reviewedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentAssignment_sessionId_studentId_key" ON "StudentAssignment"("sessionId", "studentId");
CREATE INDEX "StudentAssignment_studentId_idx" ON "StudentAssignment"("studentId");
CREATE INDEX "StudentAssignment_sessionId_idx" ON "StudentAssignment"("sessionId");
ALTER TABLE "StudentAssignment" ADD CONSTRAINT "StudentAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentAssignment" ADD CONSTRAINT "StudentAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. ConversationEntry: ссылка на задание заменяется ссылкой на урок
ALTER TABLE "ConversationEntry" DROP CONSTRAINT "ConversationEntry_assignmentId_fkey";
ALTER TABLE "ConversationEntry" DROP COLUMN "assignmentId";
ALTER TABLE "ConversationEntry" ADD COLUMN "lessonId" TEXT;
ALTER TABLE "ConversationEntry" ADD CONSTRAINT "ConversationEntry_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 10. Старая таблица Assignment удаляется (поля свёрнуты в Lesson)
DROP TABLE "Assignment";
