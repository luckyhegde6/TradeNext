// scripts/enable_timescale.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Enabling Timescale extension and creating hypertable for daily_prices...');
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;');
    await prisma.$executeRawUnsafe("SELECT create_hypertable('daily_prices','trade_date', if_not_exists => TRUE);");
    console.log('Done.');
}

main().catch((e) => {
    console.error('enable_timescale error:', e);
    process.exit(1);
}).finally(async () => {
    await prisma.$disconnect();
});

/**
 * using psql (or any Postgres client)
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "SELECT * FROM daily_prices LIMIT 5;"

psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"
psql "$DATABASE_URL" -c "SELECT create_hypertable('daily_prices', 'trade_date', if_not_exists => TRUE);"


-- via psql or GUI
SELECT * FROM pg_extension WHERE extname='timescaledb';
-- check hypertable list
SELECT * FROM timescaledb_information.hypertables;

 */