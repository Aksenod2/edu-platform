#!/usr/bin/env bash
# PreToolUse-хук (matcher: Bash) — гейт «полный BUILD перед пушем в прод-ветку».
#
# Зачем (выстрадано на OCS, 2026-06-08): пуш с зелёными юнит-тестами и
# `tsc --noEmit` уронил прод-билд — прод-сборка строже. Правило «прод-сборка
# перед каждым пушем» здесь превращено в механику:
#   - блокируем `git push` в прод-ветку, если файл-штамп .claude/.build-ok-stamp
#     отсутствует или старше последнего коммита HEAD / последних правок исходников;
#   - штамп пишет парный PostToolUse-хук post-build-stamp.sh после успешной
#     прод-сборки.
#
# Коды выхода: 0 — пропустить пуш; 2 — заблокировать (stderr уходит Клоду).
#
# ── ПАРАМЕТРЫ ПРОЕКТА (заменить {{...}} при установке) ────────────────────────
# Прод-ветка (push в неё гейтится):
PROD_BRANCH="main"
# Человекочитаемая команда сборки для сообщения блокировки:
BUILD_CMD_HINT="pnpm turbo build   # собирает и web (.next), и api (dist)"
# Каталог исходников: правки в нём делают штамп протухшим:
WATCH_DIR="apps"
# Переменная аварийного обхода (добавить в команду VAR=1):
SKIP_VAR="EDU_SKIP_BUILD_GATE"
# ──────────────────────────────────────────────────────────────────────────────

set -u

INPUT=$(cat)

# Достаём tool_input.command из JSON хука. Node как парсер (есть в большинстве
# окружений); если node недоступен или JSON не распарсился — fail-open (exit 0),
# чтобы не блокировать всю работу. Нет node в проекте → заменить на jq.
CMD=$(printf '%s' "$INPUT" | node -e '
let d = "";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    process.stdout.write(String((j.tool_input && j.tool_input.command) || ""));
  } catch { process.stdout.write(""); }
});
' 2>/dev/null) || exit 0

[ -n "$CMD" ] || exit 0

# Не git push — пропускаем.
printf '%s' "$CMD" | grep -qE 'git[[:space:]]+push' || exit 0

# Аварийный обход.
if printf '%s' "$CMD" | grep -q "${SKIP_VAR}=1"; then
  echo "⚠️ Гейт сборки перед пушем ОБОЙДЁН вручную (${SKIP_VAR}=1). Убедись, что прод-сборка действительно зелёная." >&2
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || exit 0

# --- Определяем, целится ли push в прод-ветку ---------------------------------
#   1. После "git push" явно встречается прод-ветка (включая HEAD:branch) → гейт.
#   2. Голый `git push` / `git push origin` (без refspec) → смотрим текущую ветку.
#   3. Явный refspec НЕ-прод (git push origin feature-x) → пропускаем.
#   4. Не смогли надёжно разобрать → применяем гейт (безопаснее).
TARGETS_PROD=0
PUSH_PART=$(printf '%s' "$CMD" | sed -n 's/.*\(git[[:space:]]\{1,\}push\)/\1/p')

if printf '%s' "$PUSH_PART" | grep -qE "(^|[[:space:]:])${PROD_BRANCH}([[:space:]]|\$)"; then
  TARGETS_PROD=1
else
  ARGS=$(printf '%s' "$PUSH_PART" | sed 's/^git[[:space:]]*push//' | sed 's/[;&|].*$//')
  REFSPEC=""
  POS=0
  for tok in $ARGS; do
    case "$tok" in
      -*) continue ;;
      *)
        POS=$((POS + 1))
        [ "$POS" -eq 2 ] && REFSPEC="$tok"
        ;;
    esac
  done
  if [ -n "$REFSPEC" ]; then
    TARGETS_PROD=0
  else
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ "$BRANCH" = "$PROD_BRANCH" ] || [ -z "$BRANCH" ]; then
      TARGETS_PROD=1
    fi
  fi
fi

[ "$TARGETS_PROD" -eq 1 ] || exit 0

# --- Проверяем свежесть штампа сборки ------------------------------------------
STAMP="$ROOT/.claude/.build-ok-stamp"

block() {
  cat >&2 <<MSG
⛔ Гейт перед пушем: прод-сборка не прогнана после последних изменений.
Запусти: ${BUILD_CMD_HINT}
После успешной сборки штамп обновится автоматически и push пройдёт.
MSG
  exit 2
}

[ -f "$STAMP" ] || block

# mtime штампа (macOS: stat -f %m; GNU: stat -c %Y).
STAMP_MTIME=$(stat -f %m "$STAMP" 2>/dev/null || stat -c %Y "$STAMP" 2>/dev/null || echo 0)

# (a) Штамп должен быть новее последнего коммита HEAD.
HEAD_CT=$(git log -1 --format=%ct 2>/dev/null || echo 0)
[ "$STAMP_MTIME" -ge "$HEAD_CT" ] || block

# (b) Штамп должен быть новее самых свежих правок в исходниках.
if [ -d "$ROOT/$WATCH_DIR" ]; then
  NEWER=$(find "$ROOT/$WATCH_DIR" -type f -newer "$STAMP" -print -quit 2>/dev/null)
  [ -z "$NEWER" ] || block
fi

exit 0
