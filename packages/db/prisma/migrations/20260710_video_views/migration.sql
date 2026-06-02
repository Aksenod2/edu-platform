-- «Лог активности студента», Этап A — трекинг просмотров загруженного видео урока.
-- СТРОГО АДДИТИВНАЯ, forward-only миграция: добавляется ОДНА новая таблица VideoView
-- с индексами и FK; существующие таблицы/колонки/данные НЕ трогаются, бэкофилла нет.
-- Безопасно для `prisma migrate deploy` на живом проде (авто-деплой из main): создание
-- новой таблицы — операция над метаданными, долгих локов и блокировок чтения/записи
-- по существующим таблицам нет.
--
-- VideoView — прогресс просмотра КОНКРЕТНОГО загруженного видео урока (LessonVideo)
--   КОНКРЕТНЫМ студентом (User) в контексте КОНКРЕТНОГО потока (Stream). Один ряд на
--   тройку (studentId, lessonVideoId, streamId) — клиент апсёртит его по биениям плеера.
--
--   watchedSec       — сумма УНИКАЛЬНЫХ просмотренных секунд (по UNION интервалов,
--                      без учёта повторного просмотра одних и тех же кусков);
--   watchedPercent   — 0..100 = watchedSec / durationSec;
--   lastPositionSec  — последняя позиция плеера (задел Ур.2 «продолжить с места»);
--   durationSec      — длительность видео, приходит с клиента (nullable, может уточняться);
--   watchedIntervals — смёрженные интервалы [[start,end],...] (JSONB), нужны для честного
--                      пересчёта watchedSec при следующих биениях; по умолчанию '[]';
--   sessionsCount    — задел Ур.2: число заходов на видео;
--   totalPlayedSec   — задел Ур.2: суммарное проигранное время (включая повторы);
--   completedAt      — когда впервые достигнут порог «досмотрел» (>=90%), иначе NULL;
--   lastWatchedAt    — время последнего прогресса (обновляется приложением при апсёрте;
--                      используется для сортировки в ленте активности студента).
--
-- onDelete: studentId/lessonVideoId/streamId — все Cascade: запись о просмотре не имеет
--   смысла без студента, видео или потока, поэтому удаляется вместе с любым из них.

-- CreateTable: прогресс просмотра видео урока студентом в контексте потока
CREATE TABLE "VideoView" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonVideoId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "watchedSec" INTEGER NOT NULL DEFAULT 0,
    "watchedPercent" INTEGER NOT NULL DEFAULT 0,
    "lastPositionSec" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER,
    "watchedIntervals" JSONB NOT NULL DEFAULT '[]',
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "totalPlayedSec" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "lastWatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: один ряд на тройку (студент, видео, поток) — апсёрт прогресса
CREATE UNIQUE INDEX "VideoView_studentId_lessonVideoId_streamId_key" ON "VideoView"("studentId", "lessonVideoId", "streamId");

-- CreateIndex: лента активности студента (сорт по дате последнего прогресса)
CREATE INDEX "VideoView_studentId_lastWatchedAt_idx" ON "VideoView"("studentId", "lastWatchedAt");

-- CreateIndex: обратная выборка «кто смотрел это видео в потоке»
CREATE INDEX "VideoView_lessonVideoId_streamId_idx" ON "VideoView"("lessonVideoId", "streamId");

-- AddForeignKey: VideoView.studentId → User (удаление студента каскадит просмотры)
ALTER TABLE "VideoView" ADD CONSTRAINT "VideoView_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: VideoView.lessonVideoId → LessonVideo (удаление видео каскадит просмотры)
ALTER TABLE "VideoView" ADD CONSTRAINT "VideoView_lessonVideoId_fkey" FOREIGN KEY ("lessonVideoId") REFERENCES "LessonVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: VideoView.streamId → Stream (удаление потока каскадит просмотры)
ALTER TABLE "VideoView" ADD CONSTRAINT "VideoView_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
