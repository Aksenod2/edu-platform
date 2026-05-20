#!/bin/sh

# Run Prisma migrations and seed in the background so the server can start immediately.
# This allows Render's health check to pass within the 60-second window.
(
  cd /app/packages/db

  # Baseline: if _prisma_migrations does not exist, mark initial migration as already applied.
  if ! npx prisma migrate status 2>&1 | grep -q "Database schema is up to date"; then
    npx prisma migrate resolve --applied 0_init 2>/dev/null || true
  fi

  npx prisma migrate deploy
  npx tsx prisma/seed.ts
) &

# Start the API server immediately
cd /app/apps/api
exec node dist/server.js
