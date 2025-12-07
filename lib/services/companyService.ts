import { poolQuery } from '@/lib/db/server';

export interface CompanyData {
  ticker: string;
  prices: { trade_date: Date; close: number }[];
  fundamentals: Record<string, unknown> | null;
}

export async function getCompanyData(ticker: string): Promise<CompanyData> {
  const upperTicker = ticker.toUpperCase();

  // Use correct Prisma table name and column names
  const qPrice = `
      SELECT "tradeDate" as trade_date, close FROM daily_prices
      WHERE ticker = $1
      ORDER BY "tradeDate" DESC
      LIMIT 30;
    `;
  const pricesRes = await poolQuery.query(qPrice, [upperTicker]);

  // fundamentals (latest)
  const qFund = `
      SELECT * FROM fundamentals
      WHERE ticker = $1
      ORDER BY "asOf" DESC
      LIMIT 1;
    `;
  const fundRes = await poolQuery.query(qFund, [upperTicker]);

  const prices = pricesRes.rows.map((r: Record<string, unknown>) => ({
    trade_date: r.trade_date as Date,
    close: Number(r.close),
  }));
  const fundamentals = fundRes.rows[0] || null;

  return { ticker: upperTicker, prices, fundamentals };
}
