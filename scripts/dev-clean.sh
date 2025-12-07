#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "  TradeNext — dev-clean (DB+Redis up + migrations)"
echo "========================================="

echo "🧹 Stopping containers and removing DB volume (project-local)..."
docker compose down -v --remove-orphans || true

echo "🧩 Starting clean local DB + Redis..."
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

# Run prisma commands on host (not in Docker) — host Node required
echo ""
echo "🗄 Running prisma generate & migrate on host (requires Node installed locally)..."
npm ci --no-audit --no-fund
npx prisma generate --schema=prisma/schema.prisma
# run migrate; if you want create-only, change to --create-only
npx prisma migrate dev --name add_indexname_to_announcements

# enable timescale (run from host)
echo ""
echo "⏳ Enabling Timescale hypertable (one-off) from host..."
# ensure ts-node available; install dev deps if missing
if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Please install Node/npm on host."
  exit 1
fi

# Run enable_timescale via ts-node (installs ts-node if not available)
if ! npx -y ts-node -v > /dev/null 2>&1; then
  echo "Installing ts-node+typescript dev deps (temporary) to run enable_timescale..."
  npm install -D ts-node typescript
fi
npx ts-node scripts/enable_timescale.ts

echo ""
echo "✅ dev-clean completed. DB + Redis are running and schema is migrated."
echo "Hint: run your Next.js app on host with: npm run dev"
