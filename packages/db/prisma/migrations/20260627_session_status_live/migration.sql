-- Статус занятия «Идёт»: занятие в эфире между Zoom meeting.started и meeting.ended.
-- Размещаем между 'planned' и 'done'.

-- Новое значение enum. ADD VALUE не используется в этой же миграции,
-- поэтому безопасно в транзакции (PostgreSQL 12+). Тип уже существует —
-- меняем только перечень значений, существующие данные/таблицы не трогаем.
ALTER TYPE "SessionStatus" ADD VALUE 'live' AFTER 'planned';
