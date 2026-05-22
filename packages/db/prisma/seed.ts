import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
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
