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
