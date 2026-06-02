// Чистая логика учёта прогресса просмотра видео урока (Этап A эпика «Лог
// активности студента»). Вынесена из роута, чтобы покрывать юнит-тестами без БД.
//
// Ключевая идея: «честные» просмотренные секунды считаются по UNION реально
// проигранных интервалов [start, end] (в секундах от начала видео). Перемотка
// назад и повторный просмотр того же фрагмента НЕ увеличивают watchedSec, а
// перемотка в конец без просмотра НЕ даёт 100%. Сами интервалы сохраняются
// (watchedIntervals) и при следующем биении плеера снова сливаются с новыми.

export type Interval = [number, number];

// Верхние границы на число интервалов — защита от раздувания JSON в БД и от
// злонамеренного/ошибочного клиента, шлющего тысячи микро-интервалов.
export const MAX_INPUT_INTERVALS = 2000;
export const MAX_MERGED_INTERVALS = 5000;

/**
 * Нормализует сырой массив интервалов: оставляет только корректные пары
 * [start, end] чисел, клампит к [0, durationSec], отбрасывает вырожденные
 * (start >= end после клампинга) и нечисловые — НЕ бросает исключение.
 */
export function sanitizeIntervals(
  raw: unknown,
  durationSec: number,
): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const a = pair[0];
    const b = pair[1];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    // Клампинг к границам видео.
    const start = Math.max(0, Math.min(a, durationSec));
    const end = Math.max(0, Math.min(b, durationSec));
    if (start >= end) continue; // вырожденный/обратный интервал — отбрасываем
    out.push([start, end]);
  }
  return out;
}

/**
 * Сливает перекрывающиеся И смежные интервалы в минимальный набор
 * непересекающихся, отсортированный по началу. Вход не обязан быть
 * отсортирован/валиден — лучше прогнать через sanitizeIntervals.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((x, y) => x[0] - y[0]);
  const merged: Interval[] = [];
  let [curStart, curEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s <= curEnd) {
      // Перекрытие или смежность (s === curEnd) — расширяем текущий.
      if (e > curEnd) curEnd = e;
    } else {
      merged.push([curStart, curEnd]);
      curStart = s;
      curEnd = e;
    }
  }
  merged.push([curStart, curEnd]);
  return merged;
}

/** Сумма длин интервалов (предполагается уже слитых). */
export function sumIntervals(intervals: Interval[]): number {
  let total = 0;
  for (const [s, e] of intervals) total += e - s;
  return total;
}

export interface ProgressResult {
  /** Слитые непересекающиеся интервалы для сохранения (watchedIntervals). */
  mergedIntervals: Interval[];
  /** Уникальные просмотренные секунды (округлены до целых). */
  watchedSec: number;
  /** Процент просмотра 0..100 (round(watchedSec/durationSec*100), ≤100). */
  watchedPercent: number;
  /** Сумма длин ВХОДЯЩИХ (сырых, до union) валидных интервалов — задел Ур.2. */
  rawPlayedSec: number;
  /** Достигнут ли порог «досмотрел» (>=90%) по итоговому проценту. */
  completed: boolean;
}

/** Порог, при котором просмотр считается завершённым. */
export const COMPLETED_PERCENT_THRESHOLD = 90;

/**
 * Считает прогресс по сохранённым + новым интервалам.
 *
 * @param storedIntervals — ранее сохранённые слитые интервалы (watchedIntervals).
 * @param newIntervals — сырые новые интервалы из биения клиента.
 * @param durationSec — длительность видео (>0; гарантирует вызывающий).
 */
export function computeProgress(
  storedIntervals: unknown,
  newIntervals: unknown,
  durationSec: number,
): ProgressResult {
  const stored = sanitizeIntervals(storedIntervals, durationSec);
  const fresh = sanitizeIntervals(newIntervals, durationSec);

  // Сумма длин ВХОДЯЩИХ валидных интервалов (с повторами) — задел totalPlayedSec.
  const rawPlayedSec = Math.round(sumIntervals(fresh));

  // UNION сохранённых и новых.
  let merged = mergeIntervals([...stored, ...fresh]);
  // Ограничение итогового числа сегментов — защита от раздувания JSON.
  if (merged.length > MAX_MERGED_INTERVALS) {
    merged = merged.slice(0, MAX_MERGED_INTERVALS);
  }

  const watchedSec = Math.round(sumIntervals(merged));
  const watchedPercent =
    durationSec > 0 ? Math.min(100, Math.round((watchedSec / durationSec) * 100)) : 0;
  const completed = watchedPercent >= COMPLETED_PERCENT_THRESHOLD;

  return { mergedIntervals: merged, watchedSec, watchedPercent, rawPlayedSec, completed };
}
