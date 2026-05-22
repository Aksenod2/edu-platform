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
// Только дата (для Lesson.date @db.Date), без времени.
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
      status: 'done',
      date: dateOnly(daysAgo(10)),
      startTime: '19:00',
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
      status: 'done',
      date: dateOnly(daysAgo(3)),
      startTime: '19:00',
      sortOrder: 2,
      teachers: { create: { userId: teacher.id } },
    },
  });

  await prisma.lesson.create({
    data: {
      streamId: stream.id,
      title: 'Прототипирование и вайрфреймы',
      summary: 'От лоу-фай вайрфреймов к интерактивному прототипу. Принципы и инструменты.',
      notes: 'Сначала структура и логика, потом визуал. Прототип — для проверки гипотез.',
      status: 'planned',
      date: dateOnly(daysFromNow(2)),
      startTime: '19:00',
      meetingUrl: 'https://meet.google.com/demo-ux-room',
      sortOrder: 3,
      teachers: { create: { userId: teacher.id } },
    },
  });

  // Черновик — урок в подготовке, ученикам пока не виден.
  await prisma.lesson.create({
    data: {
      streamId: stream.id,
      title: 'Юзабилити-тестирование',
      summary: 'Как планировать и проводить тесты удобства, считать метрики и формулировать выводы.',
      status: 'draft',
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

  // ── Сообщения (диалог студента) ────────────────────────────────────────────
  // Диалог с последней репликой от студента — чтобы инбокс «Сообщения» и фильтр
  // «Ждут ответа» были наполнены. Conversation типа student уникален по studentId,
  // поэтому записи пересоздаём отдельно (idempotent).
  const conversation = await prisma.conversation.upsert({
    where: { studentId: student.id },
    update: {},
    create: { type: 'student', studentId: student.id },
  });
  await prisma.conversationEntry.deleteMany({
    where: { conversationId: conversation.id },
  });
  const HOUR = 60 * 60 * 1000;
  await prisma.conversationEntry.createMany({
    data: [
      {
        conversationId: conversation.id,
        authorId: teacher.id,
        type: 'comment',
        content: 'Привет! Если будут вопросы по урокам или заданиям — пиши сюда.',
        createdAt: new Date(Date.now() - 2 * HOUR),
        readAt: new Date(Date.now() - 1.5 * HOUR),
      },
      {
        conversationId: conversation.id,
        authorId: student.id,
        type: 'text',
        content: 'Здравствуйте! Не до конца понял, как оформить CJM — можно пример?',
        createdAt: new Date(Date.now() - 0.5 * HOUR),
        readAt: null,
      },
    ],
  });

  console.log(
    `Demo seed готов: поток «${STREAM_NAME}» — 4 урока (2 проведено, 1 запланирован, 1 черновик), ` +
      `2 задания, тред с вопросом от студента. Студент: ${student.email}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
