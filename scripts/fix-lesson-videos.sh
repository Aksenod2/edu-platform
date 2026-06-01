#!/usr/bin/env bash
# ============================================================================
# Разовый «чинильщик» битых видео уроков (конвертированных из Яндекс.Телемоста).
#
# Зачем: у части MP4, сконвертированных из Телемоста, служебный индекс (атом
# `moov`) лежит НЕ в начале файла и/или индекс кривой — браузер на середине
# «теряется» и перематывает видео в начало. Лечится пересборкой файла
# (remux) с `-movflags +faststart` — БЕЗ перекодирования, без потери качества.
#
# Где запускается: НА VPS (вызывается из .github/workflows/fix-lesson-videos.yml
# по SSH). Использует:
#   - контейнер `api` (там @aws-sdk/client-s3 и S3_* из .env.vps) для S3-операций
#     через node-утилиты scripts/lib/s3-*.cjs — тот же путь к хранилищу, что и у
#     приложения, поэтому гарантированно рабочий;
#   - docker-образ ffmpeg для пересборки/диагностики (хост-ffmpeg не требуется).
#
# Режимы:
#   diagnose      — ТОЛЬКО ЧТЕНИЕ: качает файл, печатает диагностику (порядок
#                   атомов moov/mdat, длительность, кодеки, ошибки декодирования).
#                   Ничего в хранилище не меняет. Запускать ПЕРВЫМ.
#   fix           — пересборка remux (-c copy +faststart) + замена в S3 с
#                   резервной копией оригинала. Если remux не даёт корректный
#                   файл — НЕ трогает прод и просит fix-reencode.
#   fix-reencode  — то же, но с полным перекодированием (H.264/AAC) — запасной
#                   вариант, если remux недостаточен (сильно битый поток).
#
# Использование:
#   bash scripts/fix-lesson-videos.sh <diagnose|fix|fix-reencode> "<key1,key2,...>"
# Ключи — через запятую или пробел. Если не заданы — берутся ключи по умолчанию
# (уроки 1, 2, 4).
# ============================================================================
set -euo pipefail

MODE="${1:-diagnose}"
KEYS_ARG="${2:-}"

# Ключи проблемных видео по умолчанию (уроки 1, 2, 4). Заданы заказчиком.
DEFAULT_KEYS=(
  "lesson-videos/1780214866837-a7cbfe58-fb5b-4d27-bb25-aa5bf2e53bc7.mp4"
  "lesson-videos/1779697488830-eb6907df-56c3-4792-a836-9cc122e467fa.mp4"
  "lesson-videos/1779663490533-c99303c8-8189-44b5-befe-e95537aadd01.mp4"
)

case "$MODE" in
  diagnose|fix|fix-reencode) ;;
  *) echo "Неизвестный режим: $MODE (ожидается diagnose|fix|fix-reencode)"; exit 2 ;;
esac

# Разбираем ключи: из аргумента (через запятую/пробел) либо дефолтные.
KEYS=()
if [[ -n "$KEYS_ARG" ]]; then
  IFS=', ' read -r -a KEYS <<< "$KEYS_ARG"
else
  KEYS=("${DEFAULT_KEYS[@]}")
fi

# --- Окружение VPS ----------------------------------------------------------
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

if [[ ! -f .env.vps ]]; then
  echo "Не найден .env.vps в $REPO_DIR — скрипт рассчитан на запуск на VPS."; exit 1
fi

DC=(docker compose --env-file .env.vps -f docker-compose.vps.yml)
FFMPEG_IMAGE="${FFMPEG_IMAGE:-jrottenberg/ffmpeg:6.1-alpine}"

CID="$(${DC[@]} ps -q api || true)"
if [[ -z "$CID" ]]; then
  echo "Контейнер api не запущен — поднимите стек (scripts/vps-up.sh) и повторите."; exit 1
fi

# Тащим образ ffmpeg заранее (тихо), чтобы ошибки сети были видны явно.
echo "Готовлю образ ffmpeg ($FFMPEG_IMAGE)…"
docker pull -q "$FFMPEG_IMAGE" >/dev/null

WORK="$(mktemp -d)"
DATESTAMP="$(date -u +%Y%m%d-%H%M%S)"
cleanup() {
  rm -rf "$WORK"
  # Подчищаем временные файлы внутри контейнера (best-effort).
  "${DC[@]}" exec -T api sh -c 'rm -f /tmp/fixvid_*.mp4' >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Запуск ffmpeg/ffprobe в одноразовом контейнере с примонтированной рабочей папкой.
run_ffmpeg()  { docker run --rm -v "$WORK:/w" "$FFMPEG_IMAGE" "$@"; }
run_ffprobe() { docker run --rm -v "$WORK:/w" --entrypoint ffprobe "$FFMPEG_IMAGE" "$@"; }

# Порядок атомов: для воспроизведения по сети moov должен идти ДО mdat (faststart).
# Возвращает "ok" (faststart), "bad" (moov после mdat) или "unknown".
atom_order() {
  local file="$1" moov mdat
  moov="$(grep -aob -m1 'moov' "$file" 2>/dev/null | head -1 | cut -d: -f1 || true)"
  mdat="$(grep -aob -m1 'mdat' "$file" 2>/dev/null | head -1 | cut -d: -f1 || true)"
  if [[ -z "$moov" || -z "$mdat" ]]; then echo "unknown"; return; fi
  if (( moov < mdat )); then echo "ok"; else echo "bad"; fi
}

# Скачать объект из S3 в $WORK/<local> через контейнер api. Печатает JSON-инфо.
download() {
  local key="$1" local_name="$2"
  echo "  ↓ качаю из S3: $key"
  local info
  info="$("${DC[@]}" exec -T -e S3KEY="$key" -e OUT="/tmp/fixvid_orig.mp4" api node - < scripts/lib/s3-get.cjs)"
  docker cp "$CID:/tmp/fixvid_orig.mp4" "$WORK/$local_name"
  echo "  ℹ️  $info"
}

diagnose_file() {
  local file="$1"
  local order; order="$(atom_order "$file")"
  echo "  • порядок атомов (faststart): $order  [ok=индекс в начале, bad=индекс в конце → ПРИЧИНА сбоя]"
  echo "  • сведения о потоках/длительности:"
  run_ffprobe -v error -hide_banner \
    -show_entries format=duration,format_name,size -show_entries stream=codec_name,codec_type \
    -of default=noprint_wrappers=1 "/w/$(basename "$file")" 2>&1 | sed 's/^/      /' || true
  echo "  • проверка целостности (полное декодирование, ищем ошибки):"
  local errlog="$WORK/decode_err.txt"
  run_ffmpeg -v error -hide_banner -i "/w/$(basename "$file")" -f null - 2>"$errlog" || true
  if [[ -s "$errlog" ]]; then
    echo "      ⚠️ найдены ошибки декодирования (поток повреждён):"
    sed 's/^/        /' "$errlog" | head -20
  else
    echo "      ✅ ошибок декодирования нет — поток целый, дело в индексе (faststart)."
  fi
}

# --- Основной цикл ----------------------------------------------------------
echo "=================================================================="
echo "Режим: $MODE | файлов: ${#KEYS[@]} | $DATESTAMP UTC"
echo "=================================================================="

FAILED=0
for key in "${KEYS[@]}"; do
  [[ -z "$key" ]] && continue
  echo
  echo "▶ $key"
  download "$key" "orig.mp4"

  if [[ "$MODE" == "diagnose" ]]; then
    diagnose_file "$WORK/orig.mp4"
    rm -f "$WORK/orig.mp4"
    continue
  fi

  # --- Пересборка ---
  echo "  🛠  пересборка файла…"
  rm -f "$WORK/fixed.mp4"
  if [[ "$MODE" == "fix" ]]; then
    # remux без перекодирования: переносим moov в начало, переписываем индекс.
    if ! run_ffmpeg -v error -hide_banner -y -i /w/orig.mp4 -map 0 -c copy -movflags +faststart /w/fixed.mp4; then
      echo "  ❌ remux не удался — поток, видимо, повреждён. Запустите режим fix-reencode для этого файла."
      FAILED=1; rm -f "$WORK/orig.mp4" "$WORK/fixed.mp4"; continue
    fi
  else
    # fix-reencode: полное перекодирование в H.264/AAC + faststart.
    if ! run_ffmpeg -v error -hide_banner -y -i /w/orig.mp4 -map 0 \
          -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k -movflags +faststart /w/fixed.mp4; then
      echo "  ❌ перекодирование не удалось."
      FAILED=1; rm -f "$WORK/orig.mp4" "$WORK/fixed.mp4"; continue
    fi
  fi

  # --- Проверка результата ДО заливки ---
  if [[ ! -s "$WORK/fixed.mp4" ]]; then
    echo "  ❌ итоговый файл пуст — пропускаю, прод не трогаю."; FAILED=1; rm -f "$WORK/orig.mp4"; continue
  fi
  order_fixed="$(atom_order "$WORK/fixed.mp4")"
  if [[ "$order_fixed" != "ok" ]]; then
    echo "  ❌ в пересобранном файле индекс всё ещё не в начале ($order_fixed) — прод не трогаю."; FAILED=1; rm -f "$WORK/orig.mp4" "$WORK/fixed.mp4"; continue
  fi
  if ! run_ffprobe -v error -hide_banner -show_entries format=duration -of csv=p=0 /w/fixed.mp4 >/dev/null 2>&1; then
    echo "  ❌ пересобранный файл не читается ffprobe — прод не трогаю."; FAILED=1; rm -f "$WORK/orig.mp4" "$WORK/fixed.mp4"; continue
  fi
  orig_size=$(stat -c%s "$WORK/orig.mp4"); fixed_size=$(stat -c%s "$WORK/fixed.mp4")
  echo "  ✓ пересобрано: индекс в начале, файл читается (было $orig_size → стало $fixed_size байт)"

  # --- Замена в S3 с резервной копией ---
  backup_key="backups/lesson-videos/${DATESTAMP}/$(basename "$key")"
  docker cp "$WORK/fixed.mp4" "$CID:/tmp/fixvid_fixed.mp4"
  echo "  ⬆️  заливаю исправленный файл (оригинал → резерв $backup_key)…"
  "${DC[@]}" exec -T \
    -e S3KEY="$key" -e BACKUP_KEY="$backup_key" -e IN="/tmp/fixvid_fixed.mp4" \
    api node - < scripts/lib/s3-replace.cjs
  echo "  ✅ готово: $key обновлён, оригинал в $backup_key"
  rm -f "$WORK/orig.mp4" "$WORK/fixed.mp4"
done

echo
if [[ "$FAILED" -ne 0 ]]; then
  echo "⚠️ Завершено с замечаниями — см. сообщения выше."
  exit 1
fi
echo "✅ Готово (режим: $MODE)."
