-- Волна 1 «правовой минимум» — юридические документы, версии и согласия пользователей
-- + два новых nullable-поля User (lastName, phone). СТРОГО АДДИТИВНАЯ, forward-only
-- миграция: 2 новых enum-типа, 3 новые таблицы, 2 новые NULLABLE-колонки без DEFAULT
-- у User; существующие таблицы/колонки/данные НЕ трогаются, бэкофилла нет.
-- Безопасно для `prisma migrate deploy` на живом проде (авто-деплой из main):
-- CREATE TYPE/CREATE TABLE — операции над метаданными; ADD COLUMN nullable без
-- DEFAULT — мгновенная правка каталога без перезаписи строк и долгих локов.
--
-- LegalDocument — реестр юридических документов (8 карточек: оферта, политика ПДн,
--   cookie, правила портала, регламент услуг, реквизиты, согласие на ПДн, согласие на
--   рассылки). Сами ТЕКСТЫ живут в коде (markdown); карточки создаёт идемпотентный
--   сид (upsert по slug), версии сид НЕ создаёт.
-- LegalDocumentVersion — иммутабельный снимок текста документа (body, markdown) с
--   номером версии (уникален в рамках документа). Неизменяемость — на уровне
--   приложения (API на запись версий не даём); версии выпускает разработчик.
-- UserConsent — append-only журнал согласий пользователя с конкретной ВЕРСИЕЙ
--   документа (никогда не апдейтим/не удаляем — юридическая история; текущий статус =
--   последняя запись по userId+consentType). ip/userAgent — снимок контекста, nullable.
--   Согласия старых пользователей появятся второй волной при входе — записи просто
--   добавятся позже, схеме ничего не нужно.
--
-- onDelete: UserConsent.userId — Cascade (в проекте удаление пользователей мягкое через
--   deletedAt; при гипотетическом hard-delete ПДн вычищаются вместе с согласиями);
--   UserConsent.documentVersionId и LegalDocumentVersion.documentId — Restrict:
--   документ/версию, на которые есть ссылки, удалить нельзя (не теряем правовую историю).

-- CreateEnum: тип согласия (акцепт оферты / обработка ПДн / сервисные уведомления / рассылки)
CREATE TYPE "ConsentType" AS ENUM ('offer', 'personalData', 'serviceNotifications', 'marketing');

-- CreateEnum: действие по согласию (дано / отозвано)
CREATE TYPE "ConsentAction" AS ENUM ('granted', 'revoked');

-- AlterTable: User + фамилия (новое отдельное поле, name НЕ трогаем) + телефон
-- (формат валидируется на API). Обе колонки NULLABLE без DEFAULT — мгновенно и без локов.
ALTER TABLE "User" ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable: реестр юридических документов (карточки, тексты — в версиях)
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable: версия документа — иммутабельный markdown-снимок с номером версии
CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: append-only журнал согласий пользователя с версией документа
CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "consentType" "ConsentType" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: документ ищем по slug (offer, personal-data-policy, …)
CREATE UNIQUE INDEX "LegalDocument_slug_key" ON "LegalDocument"("slug");

-- CreateIndex: версии одного документа (список/последняя версия)
CREATE INDEX "LegalDocumentVersion_documentId_idx" ON "LegalDocumentVersion"("documentId");

-- CreateIndex: номер версии уникален в рамках документа
CREATE UNIQUE INDEX "LegalDocumentVersion_documentId_versionNumber_key" ON "LegalDocumentVersion"("documentId", "versionNumber");

-- CreateIndex: история согласий конкретного пользователя
CREATE INDEX "UserConsent_userId_idx" ON "UserConsent"("userId");

-- CreateIndex: кто согласился с конкретной версией (отчёты/аудит)
CREATE INDEX "UserConsent_documentVersionId_idx" ON "UserConsent"("documentVersionId");

-- AddForeignKey: версия → документ (Restrict: документ с версиями не удалить)
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: согласие → пользователь (Cascade: hard-delete пользователя вычищает его ПДн-историю)
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: согласие → версия документа (Restrict: версию с согласиями не удалить)
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "LegalDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
