#!/bin/sh
set -e
cd /app/packages/db
npx prisma db push --skip-generate
cd /app/apps/api
exec node dist/server.js
