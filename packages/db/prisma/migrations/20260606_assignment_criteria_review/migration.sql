-- Критерии проверки задания + разбор работы (текст разбора и автор разбора).

-- 1. Критерии проверки на задании (планка/будущий промпт для авто-проверки Claude)
ALTER TABLE "Assignment" ADD COLUMN "criteria" TEXT;

-- 2. Разбор работы студента: текст разбора и автор (имя преподавателя или «Claude»)
ALTER TABLE "StudentAssignment" ADD COLUMN "reviewText" TEXT;
ALTER TABLE "StudentAssignment" ADD COLUMN "reviewedBy" TEXT;
