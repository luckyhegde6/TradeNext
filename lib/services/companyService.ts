import { poolQuery } from '@/lib/db/server';
import type { QueryResult } from 'pg';

interface PriceRow {
  trade_date: Date;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
}

interface FundamentalsRow {
  [key: string]: unknown;
}

export interface CompanyData {
  ticker: string;
  prices: { trade_date: Date; open: number; high: number; low: number; close: number; volume: number }[];
  fundamentals: Record<string, unknown> | null;
}

export async function getCompanyData(ticker: string): Promise<CompanyData> {
  const upperTicker = ticker.toUpperCase();

  try {
    const qPrice = `
        SELECT "tradeDate" as trade_date, open, high, low, close, volume FROM daily_prices
        WHERE ticker = $1
        ORDER BY "tradeDate" DESC
        LIMIT 90;
      `;

    const pricePromise = poolQuery.query(qPrice, [upperTicker]);
    const priceTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Price query timeout')), 8000)
    );
    const pricesRes = await Promise.race([pricePromise, priceTimeoutPromise]) as QueryResult<PriceRow>;

    const qFund = `
        SELECT * FROM fundamentals
        WHERE ticker = $1
        ORDER BY "asOf" DESC
        LIMIT 1;
      `;

    const fundPromise = poolQuery.query(qFund, [upperTicker]);
    const fundTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Fundamentals query timeout')), 8000)
    );
    const fundRes = await Promise.race([fundPromise, fundTimeoutPromise]) as QueryResult<FundamentalsRow>;

    const prices = pricesRes.rows.map((r: PriceRow) => ({
      trade_date: r.trade_date,
      open: Number(r.open) || 0,
      high: Number(r.high) || 0,
      low: Number(r.low) || 0,
      close: Number(r.close) || 0,
      volume: Number(r.volume) || 0,
    }));
    const fundamentals = fundRes.rows[0] || null;

    return { ticker: upperTicker, prices, fundamentals };
  } catch (error) {
    console.warn(`Database query failed for ${ticker}:`, error);
    return {
      ticker: upperTicker,
      prices: [],
      fundamentals: null
    };
  }
}
