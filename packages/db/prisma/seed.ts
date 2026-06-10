import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Реестр юридических документов (Волна 1 «правовой минимум»). Здесь ТОЛЬКО
// карточки-документы: сами тексты живут в коде и публикуются версиями
// (LegalDocumentVersion) отдельной задачей — сид версии НИКОГДА не создаёт и не
// перетирает. upsert по slug с пустым update => повторный прогон ничего не меняет
// (идемпотентно; сид гоняется на КАЖДОМ старте api в start.sh).
const LEGAL_DOCUMENTS: ReadonlyArray<{ slug: string; title: string }> = [
  { slug: 'offer', title: 'Договор-оферта' },
  { slug: 'personal-data-policy', title: 'Политика обработки персональных данных' },
  { slug: 'cookie-policy', title: 'Политика использования файлов cookie' },
  { slug: 'portal-rules', title: 'Правила пользования порталом' },
  { slug: 'service-regulations', title: 'Регламент оказания услуг' },
  { slug: 'requisites', title: 'Реквизиты' },
  { slug: 'pd-consent', title: 'Согласие на обработку персональных данных' },
  { slug: 'marketing-consent', title: 'Согласие на получение рекламно-информационных рассылок' },
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

async function main() {
  // Юридические документы сеем ВСЕГДА (и на проде с админами тоже) — поэтому
  // ДО раннего выхода по adminCount ниже.
  await seedLegalDocuments();

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
