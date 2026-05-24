-- Посещаемость занятий потока (B5, фаза 2). Строго аддитивная миграция:
-- только новая таблица SessionAttendance + индексы. Существующие таблицы не трогаются,
-- бэкофилла нет, долгих локов нет (создаётся пустая таблица). FK с onDelete:
--   sessionId -> Session.id   ON DELETE CASCADE  (удаляем занятие — уходит и посещаемость)
--   userId    -> User.id      ON DELETE SET NULL (удаляем студента — ряд остаётся как гость)
--
-- Дедуп/идемпотентность — два НЕпересекающихся частичных уникальных индекса:
--   1) (sessionId, zoomParticipantId) WHERE zoomParticipantId IS NOT NULL
--      авто-забор Zoom апсёртит участника, повторные синки не плодят дубли;
--   2) (sessionId, userId) WHERE source = 'manual'
--      ручная отметка одна на (студент, занятие).
-- Индексы не конфликтуют: zoom-гость без userId не задевает (2),
-- ручная запись без zoomParticipantId не задевает (1).
-- Частичный уникальный индекс уже применяется в проекте (ср. 20260523_lesson_videos).

CREATE TABLE "SessionAttendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'present',
    "zoomParticipantId" TEXT,
    "displayName" TEXT,
    "email" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("id")
);

-- Обычные индексы под выборки по занятию и по студенту.
CREATE INDEX "SessionAttendance_sessionId_idx" ON "SessionAttendance"("sessionId");
CREATE INDEX "SessionAttendance_userId_idx" ON "SessionAttendance"("userId");

-- Дедуп авто-забора Zoom: один ряд на (занятие, участник Zoom).
CREATE UNIQUE INDEX "SessionAttendance_session_zoomParticipant_key"
    ON "SessionAttendance"("sessionId", "zoomParticipantId")
    WHERE "zoomParticipantId" IS NOT NULL;

-- Дедуп ручной отметки: один ряд на (занятие, студент) среди ручных записей.
CREATE UNIQUE INDEX "SessionAttendance_session_user_manual_key"
    ON "SessionAttendance"("sessionId", "userId")
    WHERE "source" = 'manual';

-- Внешние ключи.
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
