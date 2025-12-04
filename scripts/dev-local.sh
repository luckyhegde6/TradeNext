#!/usr/bin/env bash
set -e

echo "==========================================="
echo "   🚀 TradeNext – Local Dev Environment"
echo "==========================================="

# Step 1 – Start DB & Redis
echo ""
echo "🔧 Starting Postgres (Timescale) + Redis..."
docker-compose up -d db redis

echo ""
echo "⏳ Waiting for Postgres to be healthy..."
ATTEMPTS=0
until docker-compose exec db pg_isready -U postgres -d tradenext > /dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [ $ATTEMPTS -gt 30 ]; then
    echo "❌ Postgres did not become ready in time."
    exit 1
  fi
  sleep 2
done

echo "✅ Postgres is ready!"

# Step 2 – Run Prisma migrations
echo ""
echo "🗄  Running Prisma migrations inside tradenext container..."
docker-compose run --rm tradenext sh -c "
  npm ci --no-audit --no-fund &&
  npx prisma generate &&
  npx prisma migrate dev --name add_tradenext_models
"

# Step 3 – Enable Timescale
echo ""
echo "⏳ Enabling Timescale hypertable..."
docker-compose run --rm tradenext sh -c "
  npm ci --no-audit --no-fund &&
  npx ts-node scripts/enable_timescale.ts
"

echo "✅ Timescale hypertable enabled!"

# Step 4 – Start full development environment
echo ""
echo "🚀 Starting TradeNext Next.js app..."
docker-compose up tradenext

echo ""
echo "🌐 App running at: http://localhost:3000"
echo "📦 Redis at:       localhost:6379"
echo "🗄  Postgres at:   localhost:5432"

echo ""
echo "========= Helper commands ========="
echo "💾 Trigger ingestion:"
echo "curl -X POST http://localhost:3000/api/ingest/run -H \"Content-Type: application/json\" -d '{\"csvPath\":\"./api/sample_nse.csv\"}'"
echo ""
echo "🧭 Prisma Studio:"
echo "docker-compose run --rm tradenext sh -c \"npm ci --no-audit --no-fund && npx prisma studio\""
echo ""
echo "🐚 Enter container shell:"
echo "docker-compose exec tradenext sh"
echo "==========================================="
