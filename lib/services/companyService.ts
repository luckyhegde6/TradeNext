import { poolQuery } from '@/lib/db/server';
import type { QueryResult } from 'pg';

interface PriceRow {
  trade_date: Date;
  close: string | number;
}

interface FundamentalsRow {
  [key: string]: unknown;
}

export interface CompanyData {
  ticker: string;
  prices: { trade_date: Date; close: number }[];
  fundamentals: Record<string, unknown> | null;
}

export async function getCompanyData(ticker: string): Promise<CompanyData> {
  const upperTicker = ticker.toUpperCase();

  try {
    // Use correct Prisma table name and column names
    const qPrice = `
        SELECT "tradeDate" as trade_date, close FROM daily_prices
        WHERE ticker = $1
        ORDER BY "tradeDate" DESC
        LIMIT 30;
      `;

    // Add timeout to price query
    const pricePromise = poolQuery.query(qPrice, [upperTicker]);
    const priceTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Price query timeout')), 8000)
    );
    const pricesRes = await Promise.race([pricePromise, priceTimeoutPromise]) as QueryResult<PriceRow>;

    // fundamentals (latest)
    const qFund = `
        SELECT * FROM fundamentals
        WHERE ticker = $1
        ORDER BY "asOf" DESC
        LIMIT 1;
      `;

    // Add timeout to fundamentals query
    const fundPromise = poolQuery.query(qFund, [upperTicker]);
    const fundTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Fundamentals query timeout')), 8000)
    );
    const fundRes = await Promise.race([fundPromise, fundTimeoutPromise]) as QueryResult<FundamentalsRow>;

    const prices = pricesRes.rows.map((r: PriceRow) => ({
      trade_date: r.trade_date,
      close: Number(r.close),
    }));
    const fundamentals = fundRes.rows[0] || null;

    return { ticker: upperTicker, prices, fundamentals };
  } catch (error) {
    console.warn(`Database query failed for ${ticker}:`, error);
    // Return empty data instead of throwing
    return {
      ticker: upperTicker,
      prices: [],
      fundamentals: null
    };
  }
}
