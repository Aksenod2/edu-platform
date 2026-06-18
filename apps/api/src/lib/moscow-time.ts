// ─────────────────────────────────────────────────────────────────────────────
// Общие хелперы часового пояса Europe/Moscow (через Intl, без внешних либ).
//
// С 2014 года Москва — постоянный UTC+3 (без перехода на летнее время), но смещение
// НЕ хардкодим: вычисляем фактический offset зоны для конкретного момента, чтобы код
// оставался корректным при исторических/будущих изменениях правил зоны.
//
// Используется и месячным биллингом (mentorship-billing.ts — реэкспортит отсюда для
// обратной совместимости с тестами/__testing), и напоминаниями о событиях
// (event-reminders.ts — собирает UTC-инстант старта из date @db.Date + startTime "HH:MM").
// ─────────────────────────────────────────────────────────────────────────────

export const MOSCOW_TZ = 'Europe/Moscow';

// Компоненты «настенных» даты/времени в зоне Москвы для заданного момента.
export interface MoscowParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

// Разбирает момент `date` на год/месяц/день по календарю Москвы (Intl, en-CA даёт ISO-порядок).
export function moscowParts(date: Date): MoscowParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

// Смещение зоны Москвы относительно UTC (в минутах) для конкретного момента.
// Считаем как разницу между «настенным» временем Москвы и UTC для одного и того же instant.
export function moscowOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  let hour = get('hour');
  // Intl может вернуть час 24 для полуночи в некоторых средах — нормализуем к 0.
  if (hour === 24) hour = 0;
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  // Разница округлена до минут.
  return Math.round((asIfUtc - date.getTime()) / 60_000);
}

/**
 * Момент (UTC instant), которому соответствует ПОЛНОЧЬ в Москве для даты year-month-day.
 * Смещение зоны не хардкодим: берём UTC-полночь этой даты, узнаём фактический offset
 * Москвы в этот момент и сдвигаем назад. Для постоянного UTC+3 даёт 21:00 UTC прошлых суток.
 */
export function moscowMidnightUtc(year: number, month: number, day: number): Date {
  // Базовый момент: эти же «цифры» как будто они в UTC.
  const asUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Фактический offset Москвы (в минутах) для этого момента.
  const offsetMin = moscowOffsetMinutes(new Date(asUtc));
  // Настенное время Москвы = UTC + offset ⇒ нужный instant = asUtc − offset.
  return new Date(asUtc - offsetMin * 60_000);
}

/**
 * UTC-инстант, соответствующий «настенному» времени Москвы year-month-day hour:minute.
 * База — те же «цифры», как будто они в UTC; offset берём для этого базового момента
 * (для постоянного UTC+3 устойчиво). Используется для сборки старта события из
 * date @db.Date + startTime "HH:MM".
 */
export function moscowWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetMin = moscowOffsetMinutes(new Date(asUtc));
  return new Date(asUtc - offsetMin * 60_000);
}
