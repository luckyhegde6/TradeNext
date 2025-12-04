// quick script (one-off)
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
await db.$executeRaw`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;`;
await db.$executeRaw`SELECT create_hypertable('daily_prices', 'trade_date', if_not_exists => TRUE);`;
