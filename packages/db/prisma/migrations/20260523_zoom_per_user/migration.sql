-- Переход интеграции Zoom с синглтона (id 'default') на пер-преподавателя:
-- у каждого пользователя свой конфиг (одна строка на userId).
-- На проде таблица пустая (фича инертна без APP_ENCRYPTION_KEY) — данные не переносим.

-- Подчищаем возможный тестовый синглтон, чтобы NOT NULL добавился без ошибок.
DELETE FROM "ZoomIntegration";

-- Привязка к пользователю.
ALTER TABLE "ZoomIntegration" ADD COLUMN "userId" TEXT NOT NULL;

-- Один конфиг на пользователя.
CREATE UNIQUE INDEX "ZoomIntegration_userId_key" ON "ZoomIntegration"("userId");

-- Внешний ключ на User с каскадным удалением.
ALTER TABLE "ZoomIntegration" ADD CONSTRAINT "ZoomIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
