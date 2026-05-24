import {
  LESSON_STATUS_LABELS,
  type LessonStatus,
} from '@/lib/api';
import type { CalendarLesson } from '@/components/schedule-calendar';

/** Урок-занятие для единого расписания (псевдоним CalendarLesson; `streamName` уже в нём). */
export type ScheduleLesson = CalendarLesson;

/**
 * Вариант бейджа статуса занятия. Для 'live' («Идёт») берём акцентный 'default',
 * но визуально его рендерит «живой» бейдж (LessonStatusBadge) с пульсирующей
 * точкой — вариант здесь оставлен для единообразия словаря и фолбэков.
 */
export const STATUS_BADGE_VARIANT: Record<
  LessonStatus,
  'secondary' | 'default' | 'outline' | 'destructive'
> = {
  draft: 'secondary',
  planned: 'default',
  live: 'default',
  done: 'outline',
  cancelled: 'destructive',
};

export { LESSON_STATUS_LABELS };

/**
 * Все статусы в порядке для Select. 'live' стоит после 'planned' (логичный ход
 * жизни занятия), хотя в ручных меню он скрывается — это системный статус Zoom.
 */
export const STATUS_ORDER: LessonStatus[] = [
  'draft',
  'planned',
  'live',
  'done',
  'cancelled',
];

/**
 * Статусы, доступные для РУЧНОГО выбора (Select при создании/редактировании,
 * меню смены статуса). 'live' исключён — это системный статус: его ставит/снимает
 * Zoom автоматически (между meeting.started и meeting.ended).
 */
export const MANUAL_STATUS_ORDER: LessonStatus[] = STATUS_ORDER.filter(
  (s) => s !== 'live',
);

export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Кнопку «Присоединиться» к созвону показываем только для запланированного
 * занятия со ссылкой: у проведённого (done), отменённого (cancelled) или
 * черновика (draft) присоединяться уже некуда.
 */
export function canJoinMeeting(lesson: {
  status?: LessonStatus | null;
  meetingUrl?: string | null;
}): boolean {
  return lesson.status === 'planned' && Boolean(lesson.meetingUrl);
}

/** Парсит дату из ISO-строки как локальную (без UTC-сдвига). */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0);
}

/** Ключ "YYYY-MM-DD" из локальной даты. */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Понедельник недели, в которую попадает дата (00:00 локально). */
export function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // 0 = понедельник
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day, 0, 0, 0, 0);
}

/** Добавляет дни к дате (новый объект). */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);
}

/**
 * Уникальный ключ занятия. Один блок-урок может быть запланирован в нескольких
 * потоках, поэтому ключ — пара поток×урок, чтобы не было дублей React-ключей.
 */
export function lessonKey(l: ScheduleLesson): string {
  return `${l.streamId ?? 'none'}:${l.id}`;
}

/** Сортировка занятий внутри дня по времени начала. */
export function sortByTime(a: ScheduleLesson, b: ScheduleLesson): number {
  return (a.startTime ?? '').localeCompare(b.startTime ?? '');
}

/** Группирует занятия (с датой) по ключу дня "YYYY-MM-DD". */
export function groupByDay(lessons: ScheduleLesson[]): Map<string, ScheduleLesson[]> {
  const map = new Map<string, ScheduleLesson[]>();
  for (const lesson of lessons) {
    if (!lesson.date) continue;
    const key = dateKey(parseLocalDate(lesson.date));
    const list = map.get(key);
    if (list) list.push(lesson);
    else map.set(key, [lesson]);
  }
  for (const list of map.values()) list.sort(sortByTime);
  return map;
}
