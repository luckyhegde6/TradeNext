#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "  TradeNext — dev-only-host (DB+Redis in Docker; app on host)"
echo "========================================="

echo "🧩 Ensuring Postgres (Timescale) + Redis are up in Docker..."
docker compose up -d db redis

# wait for Postgres readiness
echo -n "⏳ Waiting for Postgres to be healthy"
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

echo ""
echo "✅ DB + Redis are ready in Docker."
echo "Now run the Next.js app on your host (fast dev loop):"
echo " Ensure .env has DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradenext"
echo " Then: npm run dev"
echo ""
echo "If you need to apply migrations from host (recommended once after schema changes):"
echo " npx prisma migrate dev --name add_tradenext_models"
