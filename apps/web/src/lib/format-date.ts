/**
 * Единый дом форматирования дат/времени для UI (русская локаль).
 *
 * Зачем: по коду расходятся вызовы `toLocaleDateString`/`toLocaleString`/
 * `toLocaleTimeString` с разными опциями и ручные «N мин назад» (где-то «мин»,
 * где-то «мин.»). Здесь — канонические форматтеры на date-fns + ru-локаль.
 *
 * Все функции принимают `Date | string | number` и безопасны к невалидной дате
 * (возвращают '' — пустую строку, чтобы не рисовать «Invalid Date» в интерфейсе).
 */

import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';
import { ru } from 'date-fns/locale';

export type DateInput = Date | string | number;

/** Привести вход к Date; вернуть null для невалидного значения. */
function toDate(input: DateInput): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Дата: «5 июня 2025». Аналог toLocaleDateString c day/month/year. */
export function formatDate(input: DateInput): string {
  const d = toDate(input);
  return d ? format(d, 'd MMMM yyyy', { locale: ru }) : '';
}

/** Дата коротко: «05.06.2025». Аналог голого toLocaleDateString('ru-RU'). */
export function formatDateShort(input: DateInput): string {
  const d = toDate(input);
  return d ? format(d, 'dd.MM.yyyy', { locale: ru }) : '';
}

/** День и месяц: «5 июня». Для лент/расписания, где год не нужен. */
export function formatDayMonth(input: DateInput): string {
  const d = toDate(input);
  return d ? format(d, 'd MMMM', { locale: ru }) : '';
}

/** День и месяц коротко: «5 июн.». Аналог { day: 'numeric', month: 'short' }. */
export function formatDayMonthShort(input: DateInput): string {
  const d = toDate(input);
  return d ? format(d, 'd MMM', { locale: ru }) : '';
}

/** Дата и время: «05.06.2025, 14:30». Аналог toLocaleString('ru-RU'). */
export function formatDateTime(input: DateInput): string {
  const d = toDate(input);
  return d ? format(d, 'dd.MM.yyyy, HH:mm', { locale: ru }) : '';
}

/** Дата и время словами: «5 июня 2025, 14:30». dateStyle:long + timeStyle:short. */
export function formatDateTimeLong(input: DateInput): string {
  const d = toDate(input);
  return d ? format(d, 'd MMMM yyyy, HH:mm', { locale: ru }) : '';
}

/** Время: «14:30». Аналог toLocaleTimeString c hour/minute. */
export function formatTime(input: DateInput): string {
  const d = toDate(input);
  return d ? format(d, 'HH:mm', { locale: ru }) : '';
}

/**
 * Относительное время одним консистентным форматом, БЕЗ точки после единиц:
 * «только что» · «5 мин назад» · «2 ч назад» · «вчера» · «5 июня».
 * Старше недели — отдаём абсолютную дату (день месяц), чтобы не было «3 нед назад».
 */
export function formatRelative(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';

  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24 && isToday(d)) return `${diffH} ч назад`;

  if (isYesterday(d)) return 'вчера';

  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) {
    // На случай, когда дата «вчера» по часам, но isYesterday уже отработал выше —
    // оставляем абсолютную дату как наиболее однозначную.
    return formatDayMonth(d);
  }

  return formatDayMonth(d);
}

/**
 * Метка дня для лент чатов: «Сегодня» / «Вчера» / «5 июня» / «5 июня 2025».
 * Год добавляем только если он отличается от текущего.
 */
export function formatDayLabel(input: DateInput, now: Date = new Date()): string {
  const d = toDate(input);
  if (!d) return '';
  if (isToday(d)) return 'Сегодня';
  if (isYesterday(d)) return 'Вчера';
  return d.getFullYear() === now.getFullYear()
    ? formatDayMonth(d)
    : formatDate(d);
}

/** Низкоуровневый помощник: произвольный формат date-fns с ru-локалью. */
export function formatPattern(input: DateInput, pattern: string): string {
  const d = toDate(input);
  return d ? format(d, pattern, { locale: ru }) : '';
}

/** «осталось N мин/ч/дн» — distance до now без суффикса «назад». */
export function formatDistanceToNow(input: DateInput): string {
  const d = toDate(input);
  return d ? formatDistanceToNowStrict(d, { locale: ru }) : '';
}
