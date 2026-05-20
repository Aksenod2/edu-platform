import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
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
