#!/bin/sh
set -e
cd /app/packages/db

# Baseline: если _prisma_migrations ещё не существует, помечаем
# начальную миграцию как уже применённую (таблицы уже есть в БД).
if ! npx prisma migrate status 2>&1 | grep -q "Database schema is up to date"; then
  npx prisma migrate resolve --applied 0_init 2>/dev/null || true
fi

npx prisma migrate deploy
npx tsx prisma/seed.ts
cd /app/apps/api
exec node dist/server.js
