#!/usr/bin/env bash
# Сборка и запуск прод-стека на VPS. Вызывается из .github/workflows/vps-deploy.yml
# после git reset --hard origin/main. Считает версию по числу коммитов и прокидывает
# её build-аргументом в веб-образ (NEXT_PUBLIC_APP_VERSION) — версия в интерфейсе
# обновляется на каждый push и появляется только после успешной сборки.
set -euo pipefail

cd "$(dirname "$0")/.."

NEXT_PUBLIC_APP_VERSION="v1.$(printf '%05d' "$(git rev-list --count HEAD)")"
export NEXT_PUBLIC_APP_VERSION
echo "Деплой версии ${NEXT_PUBLIC_APP_VERSION}"

docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
# Чистим неиспользуемые образы И build-кэш, чтобы за серию деплоев не забить диск
# VPS. Раньше был только `docker image prune -f` (чистит лишь dangling-образы),
# из-за чего за много деплоев место заканчивалось и сборка падала.
docker image prune -af
docker builder prune -f
