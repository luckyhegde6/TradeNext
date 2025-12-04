-- Enable TimescaleDB extension & create hypertable for daily_prices
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- If the table doesn't exist yet (Prisma will create it), create hypertable.
-- If using prisma migrate to create table, run this SQL after migrations:
SELECT create_hypertable('daily_prices', 'trade_date', if_not_exists => TRUE);
