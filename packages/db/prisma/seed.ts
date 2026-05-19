import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 12);

  await prisma.user.upsert({
    where: { email: 'admin@platform.local' },
    update: {},
    create: {
      email: 'admin@platform.local',
      name: 'Администратор',
      passwordHash,
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
      passwordHash,
      role: 'admin',
      isActive: true,
    },
  });

  console.log('Seed: 2 admin users created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
