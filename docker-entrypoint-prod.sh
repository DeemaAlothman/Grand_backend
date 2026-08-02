#!/bin/sh
set -e

echo "[entrypoint] applying pending database migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting application..."
exec node dist/main.js
