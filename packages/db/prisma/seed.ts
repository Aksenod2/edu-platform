import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { LEGAL_CONTENT_DIR, LEGAL_VERSIONS_MANIFEST } from './legal-content/manifest';

const prisma = new PrismaClient();

// Реестр юридических документов (Волна 1 «правовой минимум»). Здесь карточки-
// документы; сами тексты живут в коде (prisma/legal-content/*.md) и публикуются
// версиями через publishLegalVersions() ниже: НОВЫЕ версии из манифеста создаются,
// существующие НИКОГДА не перетираются. upsert по slug с пустым update => повторный
// прогон ничего не меняет (идемпотентно; сид гоняется на КАЖДОМ старте api в start.sh).
const LEGAL_DOCUMENTS: ReadonlyArray<{ slug: string; title: string }> = [
  { slug: 'offer', title: 'Договор-оферта' },
  { slug: 'personal-data-policy', title: 'Политика обработки персональных данных' },
  { slug: 'cookie-policy', title: 'Политика использования файлов cookie' },
  { slug: 'portal-rules', title: 'Правила пользования порталом' },
  { slug: 'service-regulations', title: 'Регламент оказания услуг' },
  { slug: 'requisites', title: 'Реквизиты' },
  { slug: 'pd-consent', title: 'Согласие на обработку персональных данных' },
  { slug: 'marketing-consent', title: 'Согласие на получение рекламно-информационных рассылок' },
  { slug: 'meeting-recording-consent', title: 'Согласие на запись и транскрибацию встреч' },
];

async function seedLegalDocuments() {
  for (const doc of LEGAL_DOCUMENTS) {
    await prisma.legalDocument.upsert({
      where: { slug: doc.slug },
      update: {}, // существующие карточки не трогаем (идемпотентность)
      create: { slug: doc.slug, title: doc.title },
    });
  }
  console.log(`Seed: юридические документы — ${LEGAL_DOCUMENTS.length} карточек (upsert по slug)`);
}

// Публикатор версий юридических документов: создаёт LegalDocumentVersion по манифесту
// legal-content/manifest.ts. ИДЕМПОТЕНТЕН и ИММУТАБЕЛЕН: версия (documentId по slug,
// versionNumber) создаётся ТОЛЬКО если её ещё нет в БД; существующие версии не
// обновляются никогда (на них ссылаются согласия пользователей — юридическая история;
// правки md-файла опубликованной версии в БД НЕ попадают). Новая редакция = новый
// файл .v<N+1>.md + запись в манифесте.
//
// Сид гоняется на каждом старте контейнера api, поэтому любые проблемы (нет файла,
// нет карточки документа) — warn и пропуск записи, НЕ падение всего сида.
async function publishLegalVersions() {
  let created = 0;
  let skipped = 0;

  for (const entry of LEGAL_VERSIONS_MANIFEST) {
    const document = await prisma.legalDocument.findUnique({ where: { slug: entry.slug } });
    if (!document) {
      console.warn(
        `Seed[legal]: документ "${entry.slug}" не найден в реестре — версия v${entry.versionNumber} пропущена`
      );
      continue;
    }

    const existing = await prisma.legalDocumentVersion.findUnique({
      where: {
        documentId_versionNumber: {
          documentId: document.id,
          versionNumber: entry.versionNumber,
        },
      },
      select: { id: true },
    });
    if (existing) {
      // Версия уже опубликована — не трогаем (иммутабельность).
      skipped += 1;
      continue;
    }

    let body: string;
    try {
      body = await readFile(path.join(LEGAL_CONTENT_DIR, entry.file), 'utf-8');
    } catch (e) {
      console.warn(
        `Seed[legal]: не удалось прочитать ${entry.file} (${(e as Error).message}) — ` +
          `версия ${entry.slug} v${entry.versionNumber} пропущена`
      );
      continue;
    }
    if (!body.trim()) {
      console.warn(
        `Seed[legal]: файл ${entry.file} пуст — версия ${entry.slug} v${entry.versionNumber} пропущена`
      );
      continue;
    }

    await prisma.legalDocumentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: entry.versionNumber,
        body,
      },
    });
    created += 1;
    console.log(`Seed[legal]: опубликована версия ${entry.slug} v${entry.versionNumber}`);
  }

  console.log(
    `Seed: версии юридических документов — создано ${created}, уже опубликовано ${skipped} (из ${LEGAL_VERSIONS_MANIFEST.length} в манифесте)`
  );
}

async function main() {
  // Юридические документы сеем ВСЕГДА (и на проде с админами тоже) — поэтому
  // ДО раннего выхода по adminCount ниже. После карточек публикуем версии текстов.
  await seedLegalDocuments();
  await publishLegalVersions();

  // Сид создаёт дефолтные аккаунты ТОЛЬКО при первичной инициализации — когда в
  // БД ещё нет ни одного админа. На уже настроенной БД (есть реальные админы)
  // ничего не делаем, иначе дефолтные admin@/teacher@ с паролем admin123
  // возвращались бы после их удаления/переименования (дыра в безопасности).
  const adminCount = await prisma.user.count({ where: { role: 'admin' } });
  if (adminCount > 0) {
    console.log(`Seed: пропущен — в БД уже есть админы (${adminCount}). Дефолтные аккаунты не пересоздаются.`);
    return;
  }

  const adminHash = await bcrypt.hash('admin123', 12);
  const studentHash = await bcrypt.hash('student123', 12);

  await prisma.user.upsert({
    where: { email: 'admin@platform.local' },
    update: {},
    create: {
      email: 'admin@platform.local',
      name: 'Администратор',
      passwordHash: adminHash,
      role: 'admin',
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'teacher@platform.local' },
    update: {},
    create: {
      email: 'teacher@platform.local',
      name: 'Преподаватель',
      passwordHash: adminHash,
      role: 'admin',
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'student@platform.local' },
    update: {},
    create: {
      email: 'student@platform.local',
      name: 'Демо Студент',
      passwordHash: studentHash,
      role: 'student',
      isActive: true,
    },
  });

  console.log('Seed: 2 admin + 1 student users created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
