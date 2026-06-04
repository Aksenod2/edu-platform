-- «Лог активности студента», Этап A — трекинг обращений студента к материалам урока.
-- СТРОГО АДДИТИВНАЯ, forward-only миграция: добавляется ОДНА новая таблица MaterialAccess
-- с индексами и FK; существующие таблицы/колонки/данные НЕ трогаются, бэкофилла нет.
-- Безопасно для `prisma migrate deploy` на живом проде (авто-деплой из main): создание
-- новой таблицы — операция над метаданными, долгих локов и блокировок чтения/записи
-- по существующим таблицам нет.
--
-- MaterialAccess — журнал (append-only) обращений КОНКРЕТНОГО студента (User) к файлу-
--   материалу КОНКРЕТНОГО урока (Lesson) в контексте КОНКРЕТНОГО потока (Stream).
--   В отличие от VideoView это НЕ агрегат: @@unique НЕТ намеренно — каждое обращение
--   (просмотр/скачивание) = отдельная строка, повторы плодят новые записи (так решил
--   заказчик), по ним строится хронология ленты активности.
--
--   s3Key      — ключ файла-материала в FileStorage/S3 (материалы урока лежат в
--                Lesson.materials как JSON и могут меняться — поэтому ссылаемся на ключ);
--   fileName   — СНИМОК имени файла на момент обращения (для отображения в ленте, даже
--                если материал позже переименован/удалён из Lesson.materials);
--   accessType — тип обращения: 'viewed' | 'downloaded' (строкой, без enum — по конвенции
--                проекта, ср. VideoView и SessionAttendance.source/status);
--   accessedAt — время обращения, по нему сортировка в ленте активности.
--
-- onDelete: studentId/lessonId/streamId — все Cascade: запись об обращении не имеет
--   смысла без студента, урока или потока, поэтому удаляется вместе с любым из них.

-- CreateTable: журнал обращений студента к материалу урока в контексте потока
CREATE TABLE "MaterialAccess" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "accessType" TEXT NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: лента активности одного студента (сорт по времени обращения)
CREATE INDEX "MaterialAccess_studentId_accessedAt_idx" ON "MaterialAccess"("studentId", "accessedAt");

-- CreateIndex: задел под аналитику по материалу/потоку (кто обращался к материалам урока в потоке)
CREATE INDEX "MaterialAccess_lessonId_streamId_idx" ON "MaterialAccess"("lessonId", "streamId");

-- AddForeignKey: MaterialAccess.studentId → User (удаление студента каскадит обращения)
ALTER TABLE "MaterialAccess" ADD CONSTRAINT "MaterialAccess_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MaterialAccess.lessonId → Lesson (удаление урока каскадит обращения)
ALTER TABLE "MaterialAccess" ADD CONSTRAINT "MaterialAccess_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: MaterialAccess.streamId → Stream (удаление потока каскадит обращения)
ALTER TABLE "MaterialAccess" ADD CONSTRAINT "MaterialAccess_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
