-- Исключение хоста встречи (Zoom-аккаунт преподавателя, под которым создаются встречи)
-- из «гостей» посещаемости. Строго аддитивная миграция: только новые колонки.
--   ZoomIntegration.hostEmail / hostZoomUserId — кэш идентичности хоста (из /users/me),
--     чтобы помечать его ряд и не считать студентом-гостем.
--   SessionAttendance.isHost — флаг ряда хоста (не сопоставляется со студентом и не считается гостем).
-- Все колонки nullable либо BOOLEAN с DEFAULT false — в Postgres это правка метаданных,
-- без переписи таблиц и долгих локов.

ALTER TABLE "ZoomIntegration" ADD COLUMN "hostEmail" TEXT;
ALTER TABLE "ZoomIntegration" ADD COLUMN "hostZoomUserId" TEXT;
ALTER TABLE "SessionAttendance" ADD COLUMN "isHost" BOOLEAN NOT NULL DEFAULT false;
