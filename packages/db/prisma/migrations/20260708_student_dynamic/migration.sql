-- «Динамика ученика» — приватный инструмент преподавателя/админа (ученик НЕ видит):
-- markdown-конспект прогресса в формате ГИБРИД (roadmap-шапка + лента датированных записей).
-- СТРОГО АДДИТИВНАЯ, forward-only миграция: добавляются ДВЕ новые таблицы и их индексы/FK,
-- существующие таблицы/колонки/данные НЕ трогаются. Безопасно для `prisma migrate deploy`
-- на живом проде (авто-деплой из main): создание новых таблиц — операция над метаданными,
-- бэкофилла нет, долгих локов нет.
--
-- StudentDynamic — roadmap-шапка, ОДИН ряд на ученика (studentId @unique): markdown
--   «с чем пришёл / в процессе / с чем ушёл». updatedById — кто последним правил (аудит).
-- StudentDynamicEntry — лента записей прогресса (markdown). source (manual | ai_transcript) —
--   ЗАДЕЛ под Фазу 2 (Claude-автозаполнение из транскрипта), сейчас всегда 'manual'.
--   lessonId/sessionId — необязательная привязка к уроку/проведению, простые nullable TEXT
--   без FK (намеренно: связь нестрогая, урок/сессия могут быть удалены независимо).
--
-- onDelete: student → Cascade (удаление ученика убирает его динамику), updatedBy/author →
--   SetNull (удаление автора-преподавателя не должно ронять записи об ученике).

-- CreateTable: roadmap-шапка (один ряд на ученика)
CREATE TABLE "StudentDynamic" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "roadmap" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentDynamic_pkey" PRIMARY KEY ("id")
);

-- CreateTable: лента датированных записей прогресса
CREATE TABLE "StudentDynamicEntry" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lessonId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentDynamicEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: одна roadmap-шапка на ученика
CREATE UNIQUE INDEX "StudentDynamic_studentId_key" ON "StudentDynamic"("studentId");

-- CreateIndex: выборка ленты по ученику
CREATE INDEX "StudentDynamicEntry_studentId_idx" ON "StudentDynamicEntry"("studentId");

-- AddForeignKey: StudentDynamic.studentId → User (удаление ученика каскадит динамику)
ALTER TABLE "StudentDynamic" ADD CONSTRAINT "StudentDynamic_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: StudentDynamic.updatedById → User (удаление автора обнуляет ссылку)
ALTER TABLE "StudentDynamic" ADD CONSTRAINT "StudentDynamic_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: StudentDynamicEntry.studentId → User (каскад)
ALTER TABLE "StudentDynamicEntry" ADD CONSTRAINT "StudentDynamicEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: StudentDynamicEntry.authorId → User (удаление автора обнуляет ссылку)
ALTER TABLE "StudentDynamicEntry" ADD CONSTRAINT "StudentDynamicEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
