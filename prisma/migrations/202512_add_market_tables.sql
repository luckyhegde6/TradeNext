-- create tables (idempotent)
CREATE TABLE IF NOT EXISTS daily_prices (
  ticker TEXT NOT NULL,
  trade_date TIMESTAMP WITH TIME ZONE NOT NULL,
  open numeric(30,6),
  high numeric(30,6),
  low numeric(30,6),
  close numeric(30,6),
  volume bigint,
  vwap numeric(30,6),
  PRIMARY KEY (ticker, trade_date)
);

CREATE TABLE IF NOT EXISTS index_closes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_name TEXT,
  as_of TIMESTAMP WITH TIME ZONE,
  open numeric(30,6),
  high numeric(30,6),
  low numeric(30,6),
  close numeric(30,6),
  vwap numeric(30,6),
  volume bigint
);

CREATE TABLE IF NOT EXISTS index_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_name TEXT,
  ticker TEXT,
  security TEXT,
  weight numeric(10,4),
  as_of TIMESTAMP WITH TIME ZONE
);

-- Enable timescaledb extension if privileged
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Make daily_prices a hypertable (if timescaledb is available)
SELECT create_hypertable('daily_prices', 'trade_date', if_not_exists => TRUE);
