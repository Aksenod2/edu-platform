#!/bin/sh

# Run Prisma migrations and seed in the background so the server can start immediately.
# This lets the platform health check pass within its startup window.
(
  cd /app/packages/db

  # Returns 0 if the given table exists in the connected database.
  table_exists() {
    printf 'SELECT 1 FROM "%s" LIMIT 1;\n' "$1" \
      | npx prisma db execute --schema=prisma/schema.prisma --stdin >/dev/null 2>&1
  }

  # Baseline 0_init ONLY when adopting an existing schema: the app tables are
  # already present (e.g. a DB created via `db push`) but Prisma has no
  # migration history yet. On a FRESH database both conditions are false, so
  # `migrate deploy` below runs 0_init and creates the full schema. Recording
  # 0_init as applied without running it on a fresh DB would skip table
  # creation and break every later migration.
  if table_exists User && ! table_exists _prisma_migrations; then
    npx prisma migrate resolve --applied 0_init 2>/dev/null || true
  fi

  npx prisma migrate deploy
  npx tsx prisma/seed.ts
) &

# Start the API server immediately
cd /app/apps/api
exec node dist/server.js
