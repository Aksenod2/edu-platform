-- Явный «ведущий» (owner) у потока. Используется для фильтра «мои» потоки,
-- атрибуции и сортировки по умолчанию. Доступ к данным не ограничивает.

ALTER TABLE "Stream" ADD COLUMN "ownerId" TEXT;
CREATE INDEX "Stream_ownerId_idx" ON "Stream"("ownerId");
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
