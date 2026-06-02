import { describe, it, expect } from 'vitest';
import {
  sanitizeIntervals,
  mergeIntervals,
  sumIntervals,
  computeProgress,
  type Interval,
} from '../video-progress.js';

describe('mergeIntervals — слияние интервалов', () => {
  it('сливает перекрывающиеся', () => {
    const r = mergeIntervals([
      [0, 10],
      [5, 15],
    ]);
    expect(r).toEqual([[0, 15]]);
  });

  it('сливает смежные (end === start соседа)', () => {
    const r = mergeIntervals([
      [0, 10],
      [10, 20],
    ]);
    expect(r).toEqual([[0, 20]]);
  });

  it('оставляет непересекающиеся раздельными и сортирует', () => {
    const r = mergeIntervals([
      [30, 40],
      [0, 10],
    ]);
    expect(r).toEqual([
      [0, 10],
      [30, 40],
    ]);
  });

  it('поглощает вложенный интервал', () => {
    const r = mergeIntervals([
      [0, 100],
      [10, 20],
    ]);
    expect(r).toEqual([[0, 100]]);
  });

  it('пустой вход → пустой выход', () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe('sanitizeIntervals — нормализация и клампинг', () => {
  it('клампит к [0, durationSec]', () => {
    const r = sanitizeIntervals([[-5, 200]], 100);
    expect(r).toEqual([[0, 100]]);
  });

  it('отбрасывает вырожденные/обратные пары без падения', () => {
    const r = sanitizeIntervals(
      [
        [10, 10], // вырожденный
        [20, 10], // обратный
        [5, 15], // валидный
      ],
      100,
    );
    expect(r).toEqual([[5, 15]]);
  });

  it('отбрасывает нечисловые/неполные пары', () => {
    const r = sanitizeIntervals(
      [['a', 'b'], [1], null, [10, 20]] as unknown,
      100,
    );
    expect(r).toEqual([[10, 20]]);
  });

  it('не массив → пусто', () => {
    expect(sanitizeIntervals('nope', 100)).toEqual([]);
    expect(sanitizeIntervals(undefined, 100)).toEqual([]);
  });
});

describe('sumIntervals', () => {
  it('сумма длин', () => {
    expect(
      sumIntervals([
        [0, 10],
        [20, 25],
      ]),
    ).toBe(15);
  });
});

describe('computeProgress — расчёт прогресса', () => {
  const duration = 100;

  it('happy: просмотр 0..50 → 50 сек, 50%', () => {
    const r = computeProgress([], [[0, 50]], duration);
    expect(r.watchedSec).toBe(50);
    expect(r.watchedPercent).toBe(50);
    expect(r.completed).toBe(false);
    expect(r.mergedIntervals).toEqual([[0, 50]]);
  });

  it('перемотка назад / повтор того же фрагмента не растит watchedSec', () => {
    const stored: Interval[] = [[0, 50]];
    // Повторно «проигрываем» уже просмотренный фрагмент 10..40.
    const r = computeProgress(stored, [[10, 40]], duration);
    expect(r.watchedSec).toBe(50); // не вырос
    expect(r.watchedPercent).toBe(50);
    // rawPlayedSec учитывает сырое время (с повтором) — задел Ур.2.
    expect(r.rawPlayedSec).toBe(30);
  });

  it('идемпотентность: повтор тех же интервалов оставляет watchedSec стабильным', () => {
    const first = computeProgress([], [[0, 60]], duration);
    const second = computeProgress(first.mergedIntervals, [[0, 60]], duration);
    expect(second.watchedSec).toBe(first.watchedSec);
    expect(second.watchedPercent).toBe(first.watchedPercent);
  });

  it('перемотка в конец без просмотра ≠ 100%', () => {
    // Посмотрели только хвост 99..100 — это 1 сек, а не «досмотрел».
    const r = computeProgress([], [[99, 100]], duration);
    expect(r.watchedSec).toBe(1);
    expect(r.watchedPercent).toBe(1);
    expect(r.completed).toBe(false);
  });

  it('completed при достижении 90%', () => {
    const r = computeProgress([], [[0, 90]], duration);
    expect(r.watchedPercent).toBe(90);
    expect(r.completed).toBe(true);
  });

  it('completed=false при 89%', () => {
    const r = computeProgress([], [[0, 89]], duration);
    expect(r.watchedPercent).toBe(89);
    expect(r.completed).toBe(false);
  });

  it('накопление через несколько биений (union) даёт корректный процент', () => {
    let stored: Interval[] = [];
    let last = computeProgress(stored, [[0, 30]], duration);
    stored = last.mergedIntervals;
    last = computeProgress(stored, [[30, 60]], duration);
    stored = last.mergedIntervals;
    last = computeProgress(stored, [[60, 95]], duration);
    expect(last.watchedSec).toBe(95);
    expect(last.watchedPercent).toBe(95);
    expect(last.completed).toBe(true);
    expect(last.mergedIntervals).toEqual([[0, 95]]);
  });

  it('watchedPercent не превышает 100', () => {
    const r = computeProgress([[0, 100]], [[0, 100]], duration);
    expect(r.watchedPercent).toBe(100);
    expect(r.watchedSec).toBe(100);
  });

  it('клампит интервалы за пределами duration', () => {
    const r = computeProgress([], [[0, 500]], duration);
    expect(r.watchedSec).toBe(100);
    expect(r.watchedPercent).toBe(100);
  });
});
