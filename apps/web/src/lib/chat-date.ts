/**
 * Форматирование дат для лент чатов: разделители-«чипы» между группами
 * сообщений разных дней (как в мессенджерах).
 */

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Нужен ли разделитель даты перед текущим сообщением (первое — всегда да). */
export function isNewDay(prevIso: string | undefined, currentIso: string): boolean {
  if (!prevIso) return true;
  return !isSameDay(new Date(prevIso), new Date(currentIso));
}

/** «Сегодня» / «Вчера» / «5 июня» / «5 июня 2025» (если другой год). */
export function formatChatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (isSameDay(date, now)) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Вчера';
  const dayMonth = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  // toLocaleDateString с year добавляет « г.» — собираем вручную без него.
  return date.getFullYear() === now.getFullYear()
    ? dayMonth
    : `${dayMonth} ${date.getFullYear()}`;
}
