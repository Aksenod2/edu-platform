import type { ProgramType } from '@/lib/api';

// Русские подписи типов программ для UI раздела «Программы».
export const PROGRAM_TYPE_LABELS: Record<ProgramType, string> = {
  course: 'Курс',
  intensive: 'Интенсив',
  mentorship: 'Менторская',
};

// Опции для Select (в порядке отображения).
export const PROGRAM_TYPE_OPTIONS: { value: ProgramType; label: string }[] = (
  Object.keys(PROGRAM_TYPE_LABELS) as ProgramType[]
).map((value) => ({ value, label: PROGRAM_TYPE_LABELS[value] }));
