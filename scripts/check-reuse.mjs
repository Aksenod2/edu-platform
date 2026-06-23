#!/usr/bin/env node
/**
 * Гейт переиспользования: запрещает заводить ЛОКАЛЬНЫЕ копии утилит, у которых
 * уже есть общий дом (см. docs/reuse-map.md). Ловит наши конкретные очаги
 * копипаста: formatDate/formatDateTime/formatTime/formatRelative/initials/relativeTime.
 *
 * Режим «новое vs старое» — ПО ИЗМЕНЁННЫМ ФАЙЛАМ (diff vs base), а НЕ по всему репо:
 *  - на текущем коде ~23 старых очага (admin/page, dashboard/page, teacher-picker и т.д.);
 *    если грепать весь репо — гейт свалит каждый PR на пред-существующем долге.
 *  - проверка только изменённых в PR файлов = «терпим старое, ловим новое»: тронул
 *    файл и завёл там локальный formatDate → 🔴; старый дубль, который ты не трогал, — молчит.
 *  - бонус: трогаешь файл со старым дублем — гейт подсветит его («чини раз уж зашёл»),
 *    но это попутная подсказка, а блокирует только то, что в diff.
 *
 * База для diff:
 *  - в GitHub Actions на pull_request — github.event.pull_request.base.sha (origin/main);
 *  - локально — origin/main (fallback: main, затем HEAD~1).
 *
 * Запуск:
 *   node scripts/check-reuse.mjs                 # авто-diff vs origin/main
 *   node scripts/check-reuse.mjs --all           # по всему репо (диагностика очагов)
 *   BASE_SHA=<sha> node scripts/check-reuse.mjs   # явная база (CI прокидывает)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Запрещённые ЛОКАЛЬНЫЕ пере-определения. Расширяемый список:
// regex ищется построчно; message — что брать вместо.
const FORBIDDEN = [
  { re: /\b(?:export\s+)?function\s+formatDate\s*\(/, msg: 'formatDate → import { formatDate } from "@/lib/format-date"' },
  { re: /\b(?:export\s+)?function\s+formatDateTime\s*\(/, msg: 'formatDateTime → "@/lib/format-date"' },
  { re: /\b(?:export\s+)?function\s+formatTime\s*\(/, msg: 'formatTime → "@/lib/format-date" (НЕ для длительности видео в сек.)' },
  { re: /\b(?:export\s+)?function\s+formatRelative(?:Time)?\s*\(/, msg: 'formatRelative → "@/lib/format-date" (formatRelative)' },
  { re: /\b(?:export\s+)?function\s+relativeTime\s*\(/, msg: 'relativeTime → "@/lib/format-date" (formatRelative)' },
  { re: /\b(?:export\s+)?function\s+initials\s*\(/, msg: 'initials → import { initials } from "@/lib/initials"' },
  { re: /\.map\(.*\[0\].*\)\.join\(\s*['"]{2}\s*\)/, msg: 'инлайн-инициалы (.map(...[0]).join("")) → import { initials } from "@/lib/initials"' },
  { re: /\.map\([^)]*\[0\][^)]*\)\s*\.\s*join\(\s*['"]{2}\s*\)/, msg: 'инлайн-инициалы (.map(w=>w[0]).join("")) → import { initials } from "@/lib/initials"' },
];

// Файлы-дома и легитимные исключения — им можно содержать эти определения.
const ALLOW = [
  'apps/web/src/lib/format-date.ts',
  'apps/web/src/lib/initials.ts',
  'apps/web/src/lib/chat-date.ts',
  'scripts/check-reuse.mjs',
];

// Какие файлы вообще проверяем.
const SCAN_EXT = /\.(ts|tsx|js|jsx)$/;
const SCAN_DIRS = ['apps/web/src/', 'apps/api/src/', 'packages/'];

const all = process.argv.includes('--all');

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function resolveBase() {
  if (process.env.BASE_SHA) return process.env.BASE_SHA;
  for (const ref of ['origin/main', 'main']) {
    if (sh('git', ['rev-parse', '--verify', '--quiet', ref])) return ref;
  }
  return 'HEAD~1';
}

function listFiles() {
  if (all) {
    return sh('git', ['ls-files', '*.ts', '*.tsx', '*.js', '*.jsx'])
      .split('\n')
      .filter(Boolean);
  }
  const base = resolveBase();
  const mergeBase = sh('git', ['merge-base', base, 'HEAD']) || base;
  const diff = sh('git', ['diff', '--name-only', '--diff-filter=ACMR', mergeBase, 'HEAD']);
  const staged = sh('git', ['diff', '--name-only', '--diff-filter=ACMR', '--cached']);
  const unstaged = sh('git', ['diff', '--name-only', '--diff-filter=ACMR']);
  // новые (untracked) файлы — в PR они будут закоммичены; локально ловим до коммита
  const untracked = sh('git', ['ls-files', '--others', '--exclude-standard']);
  const set = new Set([...diff.split('\n'), ...staged.split('\n'), ...unstaged.split('\n'), ...untracked.split('\n')].filter(Boolean));
  console.log(`reuse: diff-режим, база ${base} (merge-base ${mergeBase.slice(0, 8)}); файлов в diff: ${set.size}`);
  return [...set];
}

const files = listFiles()
  .filter((f) => SCAN_EXT.test(f))
  .filter((f) => SCAN_DIRS.some((d) => f.startsWith(d)))
  .filter((f) => !ALLOW.includes(f));

const hits = [];
for (const file of files) {
  const abs = resolve(ROOT, file);
  if (!existsSync(abs)) continue;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
    for (const { re, msg } of FORBIDDEN) {
      if (re.test(line)) hits.push({ file, line: i + 1, code: line.trim(), msg });
    }
  });
}

if (hits.length === 0) {
  console.log(`🟢 reuse-гейт: запрещённых локальных пере-определений не найдено${all ? ' (весь репо)' : ' в изменённых файлах'}.`);
  process.exit(0);
}

console.error(`\n🔴 reuse-гейт: найдены локальные копии утилит, у которых есть общий дом (docs/reuse-map.md):\n`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}`);
  console.error(`     ${h.code}`);
  console.error(`     → ${h.msg}\n`);
}
console.error(`Итого: ${hits.length}. Используй общий дом вместо локальной копии (см. docs/reuse-map.md).`);
process.exit(1);
