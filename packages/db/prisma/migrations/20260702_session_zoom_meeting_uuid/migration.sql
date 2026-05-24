-- UUID встречи Zoom для запроса итогов (meeting_summary API не принимает числовой id,
-- ему нужен UUID встречи). Строго аддитивная миграция: одна новая nullable-колонка на
-- Session. Бэкофилла нет, существующие данные не трогаются, долгих локов не возникает
-- (ADD COLUMN без DEFAULT/NOT NULL — метаданные, мгновенно). UUID заполняется из
-- вебхуков Zoom (payload.object.uuid) и используется как идентификатор пути для
-- meeting_summary; для уже прошедших занятий поле останется пустым.
ALTER TABLE "Session" ADD COLUMN "zoomMeetingUuid" TEXT;
