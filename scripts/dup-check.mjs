#!/usr/bin/env node
/**
 * Гейт на копипаст (jscpd) в режиме «лёгкий baseline»: ловим РОСТ дублирования,
 * терпим накопленный долг.
 *
 * Почему baseline по числу клонов (вариант «а» из ТЗ), а не --threshold по %:
 *  - в репо МНОГО существующего дубля (213 клонов / ~5–8%); порог по проценту
 *    шумит и зависит от объёма кода (добавил много чистого кода — % упал, дубль
 *    «спрятался»). Абсолютное число клонов — прямой и детерминированный сигнал
 *    «стало больше копипаста».
 *  - baseline лежит в репо (scripts/dup-baseline.json) и виден в ревью: если
 *    рефакторинг УБРАЛ дубли — число можно осознанно понизить (см. --update).
 *
 * Механизм «новое vs старое»:
 *  - jscpd считает clones по всей целевой области (детерминированно, не зависит
 *    от git-истории раннера → надёжно в CI);
 *  - сравниваем с baseline.clones. Больше baseline → 🔴 (появился новый дубль).
 *    Меньше/равно → 🟢. Стало меньше → подсказываем понизить baseline.
 *
 * Запуск:
 *   node scripts/dup-check.mjs            # проверка против baseline
 *   node scripts/dup-check.mjs --update   # пересчитать и записать baseline (после чистки дублей)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASELINE_PATH = resolve(__dirname, 'dup-baseline.json');
const REPORT_PATH = resolve(ROOT, '.jscpd-report/jscpd-report.json');

const TARGETS = [
  'apps/web/src',
  'apps/api/src',
  'packages/shared/src',
  'packages/ui/src',
  'packages/db/src',
];

const update = process.argv.includes('--update');

function runJscpd() {
  // jscpd возвращает ненулевой код только при threshold; у нас threshold нет,
  // поэтому он всегда 0 — решение о падении принимаем мы по baseline.
  execFileSync(
    'pnpm',
    ['exec', 'jscpd', ...TARGETS],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

function readReport() {
  if (!existsSync(REPORT_PATH)) {
    console.error(`\n🔴 Отчёт jscpd не найден: ${REPORT_PATH}`);
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  return report.statistics.total.clones;
}

console.log('jscpd: ищу копипаст в', TARGETS.join(', '), '…\n');
runJscpd();
const clones = readReport();

if (update) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ clones, note: 'Число клонов jscpd. Понижать после чистки дублей; рост = красный гейт.', updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n',
  );
  console.log(`\n✅ Baseline обновлён: clones = ${clones} → ${BASELINE_PATH}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`\n🔴 Нет baseline-файла ${BASELINE_PATH}. Создай: node scripts/dup-check.mjs --update`);
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).clones;

console.log(`\n— jscpd: клонов сейчас ${clones}, baseline ${baseline}`);

if (clones > baseline) {
  console.error(
    `\n🔴 Копипаст ВЫРОС: ${clones} > baseline ${baseline} (+${clones - baseline}).\n` +
      `   Появился новый дубль. Вынеси общее в дом (docs/reuse-map.md) вместо копирования.\n` +
      `   Детали — в отчёте выше и в .jscpd-report/jscpd-report.json (есть html-репортер при желании).`,
  );
  process.exit(1);
}

if (clones < baseline) {
  console.log(
    `\n🟢 Дублей стало МЕНЬШЕ (${clones} < ${baseline}). Отлично — зафиксируй прогресс:\n` +
      `   node scripts/dup-check.mjs --update  (понизит baseline, чтобы рост ловился от нового уровня)`,
  );
  process.exit(0);
}

console.log('\n🟢 Без роста копипаста (= baseline). Гейт пройден.');
process.exit(0);
