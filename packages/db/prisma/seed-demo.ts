import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Демо-данные: небольшая программа по UX-дизайну для удобной настройки/проверки.
// Новая модель: переиспользуемые блоки-уроки (Lesson) → собираются в программу
// (Program/ProgramLesson) → программа разворачивается в поток (Stream) проведениями
// уроков (Session). Поля задания свёрнуты в сам урок (hasAssignment + assignment*).
// Скрипт idempotent: при повторном запуске пересоздаёт только демо-программу
// (каскадно удаляя её состав/потоки/проведения/сдачи), базовых пользователей не трогает.

const prisma = new PrismaClient();

const PROGRAM_NAME = 'UX-дизайн: основы';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
// Только дата (для Session.date @db.Date), без времени.
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

  // Сброс прошлой версии демо-программы. Каскад удалит её состав (ProgramLesson),
  // потоки (Stream → Session → StudentAssignment) и связанные записи.
  // Сами блоки-уроки не привязаны к программе напрямую, поэтому подчищаем их
  // отдельно по их участию в составе удаляемой программы (до удаления программы).
  const oldPrograms = await prisma.program.findMany({
    where: { name: PROGRAM_NAME },
    include: { programLessons: true },
  });
  const oldLessonIds = oldPrograms.flatMap((p) =>
    p.programLessons.map((pl) => pl.lessonId),
  );
  await prisma.program.deleteMany({ where: { name: PROGRAM_NAME } });
  if (oldLessonIds.length > 0) {
    await prisma.lesson.deleteMany({ where: { id: { in: oldLessonIds } } });
  }

  // ── Уроки-блоки (переиспользуемые) ─────────────────────────────────────────
  // Урок 1 — с заданием (короткое).
  const lesson1 = await prisma.lesson.create({
    data: {
      title: 'Введение в UX: процесс и роли',
      summary: 'Что такое UX, чем отличается от UI, этапы дизайн-процесса и роли в команде.',
      notes: 'Ключевые этапы: research → define → ideate → prototype → test. Не путать UX и UI.',
      videoUrl: 'https://www.youtube.com/watch?v=ux-intro-demo',
      sortOrder: 1,
      hasAssignment: true,
      assignmentTitle: 'Карта пути пользователя (CJM)',
      assignmentDescription:
        'Составьте customer journey map для выбранного продукта: этапы, действия, эмоции, барьеры.',
      assignmentType: 'short',
      assignmentTags: ['research', 'cjm'],
      teachers: { create: { userId: teacher.id } },
    },
  });

  // Урок 2 — с заданием (длинное).
  const lesson2 = await prisma.lesson.create({
    data: {
      title: 'Исследование пользователей и интервью',
      summary: 'Методы качественного исследования: интервью, наблюдение, путь пользователя.',
      notes: 'Открытые вопросы, без подсказок. 5–7 респондентов обычно достаточно.',
      videoUrl: 'https://www.youtube.com/watch?v=ux-research-demo',
      sortOrder: 2,
      hasAssignment: true,
      assignmentTitle: 'Серия из 3 пользовательских интервью',
      assignmentDescription:
        'Проведите 3 интервью по гайду, зафиксируйте инсайты и сформулируйте 3 проблемы.',
      assignmentType: 'long',
      assignmentTags: ['research', 'interview'],
      teachers: { create: { userId: teacher.id } },
    },
  });

  // Урок 3 — без задания.
  const lesson3 = await prisma.lesson.create({
    data: {
      title: 'Прототипирование и вайрфреймы',
      summary: 'От лоу-фай вайрфреймов к интерактивному прототипу. Принципы и инструменты.',
      notes: 'Сначала структура и логика, потом визуал. Прототип — для проверки гипотез.',
      sortOrder: 3,
      teachers: { create: { userId: teacher.id } },
    },
  });

  // Урок 4 — без задания (в потоке будет черновиком).
  const lesson4 = await prisma.lesson.create({
    data: {
      title: 'Юзабилити-тестирование',
      summary: 'Как планировать и проводить тесты удобства, считать метрики и формулировать выводы.',
      sortOrder: 4,
      teachers: { create: { userId: teacher.id } },
    },
  });

  // ── Программа и её состав ───────────────────────────────────────────────────
  const program = await prisma.program.create({
    data: {
      name: PROGRAM_NAME,
      type: 'course',
      ownerId: teacher.id,
      whatYouLearn:
        'Базовый UX-процесс: исследование, проектирование, прототипирование и тестирование.',
      programLessons: {
        create: [
          { lessonId: lesson1.id, sortOrder: 1 },
          { lessonId: lesson2.id, sortOrder: 2 },
          { lessonId: lesson3.id, sortOrder: 3 },
          { lessonId: lesson4.id, sortOrder: 4 },
        ],
      },
    },
  });

  // ── Поток (запуск программы) ────────────────────────────────────────────────
  const stream = await prisma.stream.create({
    data: {
      name: PROGRAM_NAME,
      status: 'active',
      ownerId: teacher.id,
      programId: program.id,
    },
  });

  // Студент записан на поток.
  await prisma.streamEnrollment.create({
    data: { streamId: stream.id, userId: student.id },
  });

  // ── Проведения уроков в потоке (Session) ────────────────────────────────────
  // Урок 1 — проведён 10 дней назад.
  const session1 = await prisma.session.create({
    data: {
      streamId: stream.id,
      lessonId: lesson1.id,
      status: 'done',
      date: dateOnly(daysAgo(10)),
      startTime: '19:00',
      dueDate: daysFromNow(3),
    },
  });

  // Урок 2 — проведён 3 дня назад.
  const session2 = await prisma.session.create({
    data: {
      streamId: stream.id,
      lessonId: lesson2.id,
      status: 'done',
      date: dateOnly(daysAgo(3)),
      startTime: '19:00',
      dueDate: daysAgo(1),
    },
  });

  // Урок 3 — запланирован на через 2 дня (есть ссылка на встречу).
  await prisma.session.create({
    data: {
      streamId: stream.id,
      lessonId: lesson3.id,
      status: 'planned',
      date: dateOnly(daysFromNow(2)),
      startTime: '19:00',
      meetingUrl: 'https://meet.google.com/demo-ux-room',
    },
  });

  // Урок 4 — черновик (ученикам пока не виден, без даты).
  await prisma.session.create({
    data: {
      streamId: stream.id,
      lessonId: lesson4.id,
      status: 'draft',
    },
  });

  // ── Сдачи заданий студента (ключ — Session) ─────────────────────────────────
  // Чтобы дашборд «Требует внимания» был наполнен: одно сдано (ждёт проверки),
  // второе ещё не сдано и просрочено.
  await prisma.studentAssignment.create({
    data: {
      sessionId: session1.id,
      studentId: student.id,
      status: 'submitted',
      content: 'CJM для сервиса доставки еды — приложил основные этапы и барьеры.',
      submittedAt: daysAgo(1),
    },
  });
  await prisma.studentAssignment.create({
    data: {
      sessionId: session2.id,
      studentId: student.id,
      status: 'assigned',
    },
  });

  // ── Сообщения (диалог студента) ─────────────────────────────────────────────
  // Диалог с последней репликой от студента — чтобы инбокс «Сообщения» и фильтр
  // «Ждут ответа» были наполнены. Conversation типа student уникален по studentId,
  // поэтому записи пересоздаём отдельно (idempotent). Реплика со сдачей задания
  // теперь ссылается на урок (lessonId), а не на отдельное задание.
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
        lessonId: lesson1.id,
        createdAt: new Date(Date.now() - 0.5 * HOUR),
        readAt: null,
      },
    ],
  });

  console.log(
    `Demo seed готов: программа «${PROGRAM_NAME}» — 4 урока-блока (2 с заданием), ` +
      `поток с 4 проведениями (2 проведено, 1 запланировано, 1 черновик), ` +
      `2 сдачи задания, тред с вопросом от студента. Студент: ${student.email}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
