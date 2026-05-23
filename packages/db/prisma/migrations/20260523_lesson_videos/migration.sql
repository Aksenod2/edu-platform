-- Несколько видео на урок. Появляется отдельная таблица LessonVideo (файл ИЛИ
-- внешняя ссылка + название + порядок). Существующее одиночное видео урока
-- КОПИРУЕТСЯ первым элементом списка. Одиночные поля Lesson.videoKey/videoUrl
-- НЕ очищаем — их ещё читают легаси-экраны (потоковый менеджер уроков, материалы
-- студента), пока редизайн не завершён.

-- 1. Таблица видеозаписей урока
CREATE TABLE "LessonVideo" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "title" TEXT,
    "videoKey" TEXT,
    "videoUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonVideo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LessonVideo_lessonId_idx" ON "LessonVideo"("lessonId");
ALTER TABLE "LessonVideo" ADD CONSTRAINT "LessonVideo_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Копируем существующее одиночное видео урока первым элементом списка
INSERT INTO "LessonVideo" ("id", "lessonId", "title", "videoKey", "videoUrl", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", NULL, "videoKey", "videoUrl", 0, now(), now()
FROM "Lesson"
WHERE "videoKey" IS NOT NULL OR "videoUrl" IS NOT NULL;
