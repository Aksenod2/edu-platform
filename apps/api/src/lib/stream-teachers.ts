import { prisma } from '@platform/db';

/**
 * Преподаватели потока в новой модели данных.
 *
 * Поток больше НЕ владеет уроками напрямую. Уроки потока достижимы:
 *  - для программного потока (programId задан): через
 *    Stream.program → Program.programLessons → Lesson.teachers (LessonTeacher);
 *  - для менторского потока (programId = null): через
 *    Stream.sessions → Session.lesson.teachers.
 *
 * Логика дедупликации идентична прежней deriveStreamTeachers и используется
 * как в routes/streams.ts, так и в routes/conversations.ts.
 */

// Форма одного преподавателя из LessonTeacher → user.
type TeacherUser = { user: { id: string; name: string } };

// Загруженный поток с обоими источниками уроков (program + sessions).
// Совместима с результатом include `streamTeacherSourcesInclude`.
// program также несёт id/name/type — их удобно отдавать в ответе списка/деталей,
// при этом deriveStreamTeachers читает только programLessons.
export type StreamWithTeacherSources = {
  program: {
    id: string;
    name: string;
    type: string;
    programLessons: { lesson: { teachers: TeacherUser[] } }[];
  } | null;
  sessions: { lesson: { teachers: TeacherUser[] } }[];
};

// Prisma include для подгрузки источников преподавателей вместе с потоком.
// shared между обоими файлами, чтобы не дублировать структуру.
export const streamTeacherSourcesInclude = {
  program: {
    select: {
      id: true,
      name: true,
      type: true,
      programLessons: {
        select: {
          lesson: {
            select: {
              teachers: { include: { user: { select: { id: true, name: true } } } },
            },
          },
        },
      },
    },
  },
  sessions: {
    select: {
      lesson: {
        select: {
          teachers: { include: { user: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} as const;

/**
 * Дедуплицирует преподавателей по загруженному потоку (program + sessions).
 * shared = true, если в потоке преподаёт больше одного преподавателя.
 *
 * Менторский поток (program = null) обрабатывается единообразно: его уроки
 * берутся только из sessions, программная ветка просто пуста.
 */
export function deriveStreamTeachers(stream: {
  program: { programLessons: { lesson: { teachers: TeacherUser[] } }[] } | null;
  sessions: { lesson: { teachers: TeacherUser[] } }[];
}): {
  teachers: { id: string; name: string }[];
  shared: boolean;
} {
  const map = new Map<string, { id: string; name: string }>();

  const addTeachers = (teachers: TeacherUser[]) => {
    for (const t of teachers) {
      if (!map.has(t.user.id)) {
        map.set(t.user.id, { id: t.user.id, name: t.user.name });
      }
    }
  };

  // Программная ветка: уроки программы потока.
  for (const pl of stream.program?.programLessons ?? []) {
    addTeachers(pl.lesson.teachers);
  }
  // Менторская/сессионная ветка: уроки сессий потока.
  for (const session of stream.sessions ?? []) {
    addTeachers(session.lesson.teachers);
  }

  const teachers = [...map.values()];
  return { teachers, shared: teachers.length > 1 };
}

/**
 * Загружает поток и возвращает дедуплицированный список преподавателей {id,name}.
 * Удобно, когда у вызывающего нет уже загруженного потока.
 */
export async function getStreamTeacherList(
  streamId: string,
): Promise<{ id: string; name: string }[]> {
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    select: streamTeacherSourcesInclude,
  });
  if (!stream) return [];
  return deriveStreamTeachers(stream).teachers;
}

/**
 * АКТИВНЫЕ преподаватели ВСЕХ потоков студента (дедуплицированы по id).
 *
 * Это «правильные» получатели уведомлений о студенте: преподаватель, ведущий
 * любой из потоков студента, получает ровно одно уведомление. Неактивные/удалённые
 * преподаватели отсеиваются (их флаги не несёт список из deriveStreamTeachers).
 *
 * Возвращает ПУСТОЙ массив, если у студента нет потоков ИЛИ у потоков нет активных
 * преподавателей — решение о фолбэке (админам / владельцу / не слать) принимает
 * вызывающий, т.к. оно различается по событию (личный тред → админы, оплата → владелец,
 * чат/зачисление → не слать).
 *
 * Переиспользуется в routes/threads.ts (личный тред) и routes/payments.ts (оплата),
 * чтобы не дублировать связку enrollment → потоки → преподаватели → фильтр активности.
 */
export async function getActiveStudentStreamTeacherIds(studentId: string): Promise<string[]> {
  const enrollments = await prisma.streamEnrollment.findMany({
    where: { userId: studentId },
    select: { streamId: true },
  });
  if (enrollments.length === 0) return [];

  // Один запрос на все потоки студента вместо N тяжёлых запросов в цикле.
  const streams = await prisma.stream.findMany({
    where: { id: { in: enrollments.map((e) => e.streamId) } },
    select: streamTeacherSourcesInclude,
  });
  const teacherIds = new Set<string>();
  for (const stream of streams) {
    for (const t of deriveStreamTeachers(stream).teachers) teacherIds.add(t.id);
  }
  if (teacherIds.size === 0) return [];

  // Отсеиваем неактивных/удалённых преподавателей (список их флагов не несёт).
  const active = await prisma.user.findMany({
    where: { id: { in: [...teacherIds] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return active.map((u) => u.id);
}

/**
 * Владелец платформы — фолбэк-адресат для событий, где «деньги/студент без группы
 * не должны теряться» (например, заявка на оплату от студента без потока).
 *
 * В модели данных НЕТ отдельного флага «владелец платформы» и нет супер-роли:
 * роли только student/admin, а Stream.ownerId/Program.ownerId — это «ведущий»
 * конкретного потока/программы, а не владелец всей платформы. Поэтому за владельца
 * платформы принимаем САМОГО РАННЕГО активного админа (основателя — первый
 * заведённый в системе админ). Это детерминированно и не требует миграции схемы.
 *
 * Возвращает null, только если активных админов нет вовсе (вырожденный случай).
 */
export async function getPlatformOwnerId(): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { role: 'admin', isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return owner?.id ?? null;
}
