import { PROGRAM_TYPE_LABELS, type ProgramType } from '@/lib/api';

// Опции для Select (в порядке отображения), на едином источнике подписей (lib/api).
export const PROGRAM_TYPE_OPTIONS: { value: ProgramType; label: string }[] = (
  Object.keys(PROGRAM_TYPE_LABELS) as ProgramType[]
).map((value) => ({ value, label: PROGRAM_TYPE_LABELS[value] }));
