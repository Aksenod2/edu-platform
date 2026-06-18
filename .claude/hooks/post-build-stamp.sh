#!/usr/bin/env bash
# PostToolUse-хук (matcher: Bash) — пишет штамп .claude/.build-ok-stamp после
# успешной прод-сборки. Штамп читает парный PreToolUse-гейт pre-push-build-gate.sh.
#
# КОМПРОМИСС про «успех»: в PostToolUse JSON для Bash tool_response не содержит
# надёжного exit-кода — только stdout/stderr/interrupted. Поэтому:
#   - НЕ пишем штамп, если interrupted=true или в выводе явные маркеры провала
#     (error TS…, ELIFECYCLE, Build failed, Command failed);
#   - в остальных случаях при наличии команды сборки пишем штамп всегда.
# Ложноположительный штамп маловероятен (сборщики при падении печатают маркеры),
# ложноотрицательный просто заставит прогнать сборку ещё раз.
#
# Хук всегда выходит с кодом 0 — он ничего не блокирует.
#
# ── ПАРАМЕТРЫ ПРОЕКТА (заменить {{...}} при установке) ────────────────────────
# JS-regex команды прод-сборки (та же команда, что у хостинга/CI!).
# Пример OCS: pnpm\s+(--filter[= ]|-F[= ])@ocs\/web\s+(run\s+)?build\b
BUILD_CMD_REGEX='pnpm\s+turbo\s+build\b'
# Маркеры провала сборки в выводе (дополнить под свой стек: cargo/go/maven...):
FAIL_REGEX='error TS\d+|ELIFECYCLE|Build failed|Command failed|Type error'
# ──────────────────────────────────────────────────────────────────────────────

set -u

INPUT=$(cat)

PARSED=$(printf '%s' "$INPUT" | BUILD_CMD_REGEX="$BUILD_CMD_REGEX" FAIL_REGEX="$FAIL_REGEX" node -e '
let d = "";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    const cmd = String((j.tool_input && j.tool_input.command) || "");
    const r = j.tool_response || {};
    const out = (typeof r === "string")
      ? r
      : String(r.stdout || "") + "\n" + String(r.stderr || "");
    const interrupted = (typeof r === "object" && r !== null && r.interrupted === true);

    const isBuild = new RegExp(process.env.BUILD_CMD_REGEX).test(cmd);
    const failed = interrupted ||
      new RegExp(process.env.FAIL_REGEX, "i").test(out);

    process.stdout.write(isBuild ? (failed ? "FAIL" : "OK") : "SKIP");
  } catch { process.stdout.write("SKIP"); }
});
' 2>/dev/null) || exit 0

[ "$PARSED" = "OK" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
mkdir -p "$ROOT/.claude" 2>/dev/null || exit 0
date +%s > "$ROOT/.claude/.build-ok-stamp" 2>/dev/null

exit 0
