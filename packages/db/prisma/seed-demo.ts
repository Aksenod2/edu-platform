import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Демо-данные: небольшой курс по UX-дизайну для удобной настройки/проверки.
// Скрипт idempotent: при повторном запуске пересоздаёт только демо-поток
// (каскадно удаляя его уроки/задания/расписание), базовых пользователей не трогает.

const prisma = new PrismaClient();

const STREAM_NAME = 'UX-дизайн: основы';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
// Только дата (для ScheduleEntry @db.Date), без времени.
const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10));

async function getOrCreateUser(
  email: string,
  name: string,
  role: 'admin' | 'student',
  password: string,
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      name,
      role,
      passwordHash: await bcrypt.hash(password, 12),
      isActive: true,
    },
  });
}

async function main() {
  // Преподаватель и студент — переиспользуем базовых (из seed.ts) или создаём.
  const teacher = await getOrCreateUser(
    'teacher@platform.local',
    'Преподаватель',
    'admin',
    'admin123',
  );
  const student = await getOrCreateUser(
    'student@platform.local',
    'Демо Студент',
    'student',
    'student123',
  );

  // Сброс прошлой версии демо-курса (каскад удалит уроки/задания/расписание/записи).
  await prisma.stream.deleteMany({ where: { name: STREAM_NAME } });

  const stream = await prisma.stream.create({
    data: { name: STREAM_NAME, status: 'active' },
  });

  // Студент записан на поток.
  await prisma.streamEnrollment.create({
    data: { streamId: stream.id, userId: student.id },
  });

  // ── Уроки ────────────────────────────────────────────────────────────────
  const lesson1 = await prisma.lesson.create({
    data: {
      streamId: stream.id,
      title: 'Введение в UX: процесс и роли',
      summary: 'Что такое UX, чем отличается от UI, этапы дизайн-процесса и роли в команде.',
      notes: 'Ключевые этапы: research → define → ideate → prototype → test. Не путать UX и UI.',
      videoUrl: 'https://www.youtube.com/watch?v=ux-intro-demo',
      status: 'published',
      publishAt: daysAgo(20),
      sortOrder: 1,
      teachers: { create: { userId: teacher.id } },
    },
  });

  const lesson2 = await prisma.lesson.create({
    data: {
      streamId: stream.id,
      title: 'Исследование пользователей и интервью',
      summary: 'Методы качественного исследования: интервью, наблюдение, путь пользователя.',
      notes: 'Открытые вопросы, без подсказок. 5–7 респондентов обычно достаточно.',
      videoUrl: 'https://www.youtube.com/watch?v=ux-research-demo',
      status: 'published',
      publishAt: daysAgo(13),
      sortOrder: 2,
      teachers: { create: { userId: teacher.id } },
    },
  });

  const lesson3 = await prisma.lesson.create({
    data: {
      streamId: stream.id,
      title: 'Прототипирование и вайрфреймы',
      summary: 'От лоу-фай вайрфреймов к интерактивному прототипу. Принципы и инструменты.',
      notes: 'Сначала структура и логика, потом визуал. Прототип — для проверки гипотез.',
      status: 'published',
      publishAt: daysAgo(6),
      sortOrder: 3,
      teachers: { create: { userId: teacher.id } },
    },
  });

  // Черновик с будущей датой публикации — чтобы было что «настраивать».
  const lesson4 = await prisma.lesson.create({
    data: {
      streamId: stream.id,
      title: 'Юзабилити-тестирование',
      summary: 'Как планировать и проводить тесты удобства, считать метрики и формулировать выводы.',
      status: 'draft',
      publishAt: daysFromNow(7),
      sortOrder: 4,
      teachers: { create: { userId: teacher.id } },
    },
  });

  // ── Задания ──────────────────────────────────────────────────────────────
  const assignment1 = await prisma.assignment.create({
    data: {
      streamId: stream.id,
      lessonId: lesson1.id,
      title: 'Карта пути пользователя (CJM)',
      description: 'Составьте customer journey map для выбранного продукта: этапы, действия, эмоции, барьеры.',
      type: 'short',
      tags: ['research', 'cjm'],
      dueDate: daysFromNow(3),
    },
  });

  const assignment2 = await prisma.assignment.create({
    data: {
      streamId: stream.id,
      lessonId: lesson2.id,
      title: 'Серия из 3 пользовательских интервью',
      description: 'Проведите 3 интервью по гайду, зафиксируйте инсайты и сформулируйте 3 проблемы.',
      type: 'long',
      tags: ['research', 'interview'],
      dueDate: daysAgo(1),
    },
  });

  // Статусы заданий студента — чтобы дашборд «Требует внимания» был наполнен:
  // одно сдано (ждёт проверки), второе не сдано и просрочено.
  await prisma.studentAssignment.create({
    data: {
      assignmentId: assignment1.id,
      studentId: student.id,
      status: 'submitted',
      content: 'CJM для сервиса доставки еды — приложил основные этапы и барьеры.',
      submittedAt: daysAgo(1),
    },
  });
  await prisma.studentAssignment.create({
    data: {
      assignmentId: assignment2.id,
      studentId: student.id,
      status: 'assigned',
    },
  });

  // ── Расписание ───────────────────────────────────────────────────────────
  const meetingUrl = 'https://meet.google.com/demo-ux-room';
  await prisma.scheduleEntry.createMany({
    data: [
      {
        streamId: stream.id,
        lessonId: lesson3.id,
        date: dateOnly(daysFromNow(2)),
        startTime: '19:00',
        lessonTitle: lesson3.title,
        meetingUrl,
      },
      {
        streamId: stream.id,
        lessonId: lesson4.id,
        date: dateOnly(daysFromNow(5)),
        startTime: '18:30',
        lessonTitle: lesson4.title,
        meetingUrl,
      },
      {
        streamId: stream.id,
        lessonId: lesson1.id,
        date: dateOnly(daysAgo(3)),
        startTime: '19:00',
        lessonTitle: lesson1.title,
      },
    ],
  });

  console.log(
    `Demo seed готов: поток «${STREAM_NAME}» — 4 урока (3 опубликовано, 1 черновик), ` +
      `2 задания, 3 записи расписания. Студент: ${student.email}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
