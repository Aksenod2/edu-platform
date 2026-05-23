// Тип урока-БЛОКА (копилка). Поля свёрнутого задания (folded assignment) теперь
// объявлены в типе Lesson (lib/api), поэтому здесь — лишь семантический псевдоним;
// чтение/запись блока идут напрямую через getLesson/updateLesson без потока.
import type { Lesson } from '@/lib/api';

export type { AssignmentType } from '@/lib/api';

export type LessonBlock = Lesson;
