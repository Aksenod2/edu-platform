import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Манифест опубликованных версий юридических документов (Волна 1 «правовой минимум»).
//
// ПРАВИЛО ИММУТАБЕЛЬНОСТИ: опубликованная версия НЕИЗМЕНЯЕМА. Публикатор в seed.ts
// создаёт LegalDocumentVersion только если пары (slug, versionNumber) ещё нет в БД;
// существующие версии он НИКОГДА не трогает — повторный прогон сида и любые правки
// md-файла уже опубликованной версии НИЧЕГО не меняют в БД (и менять не должны:
// на версию ссылаются согласия пользователей, это юридическая история).
//
// Новая редакция документа = НОВЫЙ файл <slug>.v2.md + НОВАЯ запись в этом массиве
// с versionNumber: 2. Старый файл .v1.md остаётся в репозитории как исходник
// уже опубликованной версии.
//
// Тексты — реальные юридические документы заказчика: править можно ТОЛЬКО разметку
// (и только до публикации версии), смысловые правки текста — только через заказчика.

export interface LegalVersionManifestEntry {
  /** slug документа из реестра LegalDocument (сидится в seed.ts) */
  slug: string;
  /** номер версии; уникален в рамках документа */
  versionNumber: number;
  /** имя md-файла в этом каталоге */
  file: string;
}

export const LEGAL_VERSIONS_MANIFEST: ReadonlyArray<LegalVersionManifestEntry> = [
  { slug: 'offer', versionNumber: 1, file: 'offer.v1.md' },
  { slug: 'personal-data-policy', versionNumber: 1, file: 'personal-data-policy.v1.md' },
  { slug: 'cookie-policy', versionNumber: 1, file: 'cookie-policy.v1.md' },
  { slug: 'portal-rules', versionNumber: 1, file: 'portal-rules.v1.md' },
  { slug: 'service-regulations', versionNumber: 1, file: 'service-regulations.v1.md' },
  { slug: 'requisites', versionNumber: 1, file: 'requisites.v1.md' },
  { slug: 'pd-consent', versionNumber: 1, file: 'pd-consent.v1.md' },
  { slug: 'marketing-consent', versionNumber: 1, file: 'marketing-consent.v1.md' },
  {
    slug: 'meeting-recording-consent',
    versionNumber: 1,
    file: 'meeting-recording-consent.v1.md',
  },
];

// Каталог с md-файлами — относительно ЭТОГО модуля (а не process.cwd()), чтобы сид
// одинаково работал локально (`pnpm db:seed` из packages/db) и в Docker-образе api
// (start.sh запускает `npx tsx prisma/seed.ts` из /app/packages/db).
export const LEGAL_CONTENT_DIR = path.dirname(fileURLToPath(import.meta.url));
