-- Эпик «Изоляция материалов урока по группам», Задача 1 — пер-потоковое учебное видео урока.
-- СТРОГО АДДИТИВНАЯ, forward-only миграция: добавляется ОДНА nullable-колонка LessonVideo.streamId,
-- один индекс и один FK. Существующие данные НЕ трогаются, бэкофилл НЕ нужен.
--
-- БЕЗОПАСНОСТЬ для `prisma migrate deploy` на живом проде (авто-деплой из main):
--   * ADD COLUMN nullable БЕЗ DEFAULT — операция над метаданными в PostgreSQL: таблица НЕ
--     переписывается, долгого эксклюзивного лока нет; существующие строки LessonVideo получают
--     streamId = NULL, что по семантике = «общее учебное видео урока (метод), видно всем потокам».
--   * CREATE INDEX (без CONCURRENTLY, как во всех миграциях проекта) — короткий лок на запись по
--     таблице LessonVideo; таблица невелика и не на горячем пути записи, влияние пренебрежимо.
--   * ADD FOREIGN KEY на nullable-колонку с ON DELETE SET NULL — валидируется по существующим
--     строкам (все NULL → проверка тривиальна), без перезаписи данных.
--   Потери данных нет, ломающих изменений нет, откат не требуется.
--
-- СЕМАНТИКА streamId:
--   NULL  = общее учебное видео урока («метод»), видно студентам ВСЕХ потоков;
--   задан = видео видно ТОЛЬКО студентам этого потока.
-- onDelete: SET NULL — при удалении потока видео НЕ теряется, а становится общим (NULL).

-- AlterTable: nullable-колонка привязки видео к потоку (NULL = общее видео)
ALTER TABLE "LessonVideo" ADD COLUMN "streamId" TEXT;

-- CreateIndex: фильтр «общие (streamId IS NULL) + видео конкретного потока» в рамках одного урока
CREATE INDEX "LessonVideo_lessonId_streamId_idx" ON "LessonVideo"("lessonId", "streamId");

-- AddForeignKey: LessonVideo.streamId → Stream; удаление потока обнуляет привязку (видео → общее)
ALTER TABLE "LessonVideo" ADD CONSTRAINT "LessonVideo_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;
