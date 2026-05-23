// Блок-уровень «Уроков» (копилка): тонкая обёртка над lib/api для работы со
// СВЁРНУТЫМ заданием (folded assignment*). Бэкенд /lessons уже принимает и
// отдаёт эти поля, но типы lib/api их не объявляют (и сам файл править нельзя),
// поэтому здесь расширяем тип и приводим payload на границе вызова.

import {
  getLesson as apiGetLesson,
  updateLesson as apiUpdateLesson,
  type Lesson,
  type LessonMaterial,
} from '@/lib/api';

export type AssignmentType = 'short' | 'long';

// Свёрнутые в блок урока поля задания (как их хранит/отдаёт бэкенд).
export interface LessonAssignmentFields {
  hasAssignment: boolean;
  assignmentTitle: string | null;
  assignmentDescription: string | null;
  assignmentCriteria: string | null;
  assignmentType: AssignmentType | null;
  assignmentTags: string[];
}

// Урок-БЛОК = Lesson из lib/api + folded assignment-поля.
export type LessonBlock = Lesson & Partial<LessonAssignmentFields>;

// Поля блока, доступные для сохранения через PATCH /lessons/:id (без streamId,
// т.е. правим сам блок, а не расписание Session потока).
export interface LessonBlockUpdate {
  title?: string;
  videoUrl?: string;
  summary?: string;
  notes?: string;
  sortOrder?: number;
  teacherIds?: string[];
  materials?: LessonMaterial[];
  hasAssignment?: boolean;
  assignmentTitle?: string | null;
  assignmentDescription?: string | null;
  assignmentCriteria?: string | null;
  assignmentType?: AssignmentType | null;
  assignmentTags?: string[];
}

// GET /lessons/:id с folded assignment-полями в ответе.
export async function getLessonBlock(
  accessToken: string,
  id: string,
): Promise<{ lesson: LessonBlock }> {
  const res = await apiGetLesson(accessToken, id);
  return { lesson: res.lesson as LessonBlock };
}

// PATCH /lessons/:id БЕЗ streamId → обновляет поля блока (включая assignment*).
export async function updateLessonBlock(
  accessToken: string,
  id: string,
  data: LessonBlockUpdate,
): Promise<{ lesson: LessonBlock }> {
  // lib/api типизирует updateLesson без assignment*-полей, но рантайм их
  // принимает — расширяем тип на границе вызова.
  const res = await apiUpdateLesson(
    accessToken,
    id,
    data as Parameters<typeof apiUpdateLesson>[2],
  );
  return { lesson: res.lesson as LessonBlock };
}
