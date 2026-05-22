-- Объединение «Уроки» и «Расписание» в одну сущность «Урок».
-- Поля расписания переезжают в Lesson, ScheduleEntry удаляется, статусы заменяются.

-- 1. Новые поля расписания в самом уроке
ALTER TABLE "Lesson" ADD COLUMN "date" DATE;
ALTER TABLE "Lesson" ADD COLUMN "startTime" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "meetingUrl" TEXT;

-- 2. Переносим расписание привязанных уроков
--    (приоритет у записи, управляемой из урока; затем самая ранняя дата)
UPDATE "Lesson" l
SET "date" = se."date", "startTime" = se."startTime", "meetingUrl" = se."meetingUrl"
FROM (
  SELECT DISTINCT ON ("lessonId") "lessonId", "date", "startTime", "meetingUrl"
  FROM "ScheduleEntry"
  WHERE "lessonId" IS NOT NULL
  ORDER BY "lessonId", "managedByLesson" DESC, "date" ASC
) se
WHERE se."lessonId" = l."id";

-- 3. Записи расписания без урока (ad-hoc) превращаем в отдельные уроки без контента
INSERT INTO "Lesson" (
  "id", "streamId", "title", "videoUrl", "videoKey", "summary", "notes",
  "status", "sortOrder", "materials", "date", "startTime", "meetingUrl",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), se."streamId", se."lessonTitle", NULL, NULL, NULL, se."notes",
  'published'::"LessonStatus", 0, '[]'::jsonb, se."date", se."startTime", se."meetingUrl",
  now(), now()
FROM "ScheduleEntry" se
WHERE se."lessonId" IS NULL;

-- 4. Новый набор статусов: draft/planned/done/cancelled (с маппингом старых значений)
ALTER TYPE "LessonStatus" RENAME TO "LessonStatus_old";
CREATE TYPE "LessonStatus" AS ENUM ('draft', 'planned', 'done', 'cancelled');
ALTER TABLE "Lesson" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lesson" ALTER COLUMN "status" TYPE "LessonStatus" USING (
  CASE
    WHEN "status"::text = 'draft' THEN 'draft'
    WHEN "status"::text = 'published' AND "date" IS NOT NULL AND "date" < CURRENT_DATE THEN 'done'
    WHEN "status"::text = 'published' AND "date" IS NULL THEN 'done'
    WHEN "status"::text = 'published' THEN 'planned'
    WHEN "status"::text = 'closed' THEN 'done'
    ELSE 'draft'
  END::"LessonStatus"
);
ALTER TABLE "Lesson" ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "LessonStatus_old";

-- 5. Чистим: publishAt больше не нужен, ScheduleEntry удаляем
ALTER TABLE "Lesson" DROP COLUMN "publishAt";
DROP TABLE "ScheduleEntry";
