#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting local DB (Timescale) + Redis..."
docker compose up -d db redis

# Wait for Postgres readiness
echo -n "⏳ Waiting for Postgres "
ATTEMPTS=0
until docker compose exec db pg_isready -U postgres -d tradenext > /dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [ $ATTEMPTS -gt 60 ]; then
    echo
    echo "❌ Postgres did not become ready in time."
    exit 1
  fi
  printf "."
  sleep 2
done
echo " ✅"

echo "✅ DB + Redis are ready."
echo ""
echo "Hint: run migrations from host with:"
echo "  npx prisma migrate dev --name add_indexname_to_announcements"
echo "Then enable Timescale with:"
echo "  npx ts-node scripts/enable_timescale.ts"
