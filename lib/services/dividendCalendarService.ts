/**
 * Dividend Calendar Service
 *
 * Fetches and enriches dividend corporate actions for the dividend calendar page.
 * Computes estimated dividend income based on user holdings.
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

/* ─── Types ─── */

export interface DividendEvent {
  id: number;
  symbol: string;
  companyName: string;
  exDate: string | null;
  recordDate: string | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
  currentPrice: number | null;
  faceValue: string | null;
  ratio: string | null;
  actionType: string;
  source: string;
  isin: string | null;
}

export interface DividendSummary {
  upcomingCount: number;
  estMonthlyIncome: number;
  estAnnualIncome: number;
  avgYield: number | null;
  totalDividends: number;
}

export interface MonthlyIncome {
  month: number; // 1-12
  year: number;
  label: string; // e.g., "Jan 2026"
  income: number;
  count: number;
}

export interface DividendCalendarData {
  dividends: DividendEvent[];
  summary: DividendSummary;
  monthlyIncome: MonthlyIncome[];
  month: number;
  year: number;
}

/* ─── Service Functions ─── */

/**
 * Get dividends for a specific month/year with enrichment.
 */
export async function getDividendCalendar(
  month: number,
  year: number,
  userId?: number
): Promise<DividendCalendarData> {
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const dividends = await fetchDividends(startDate, endDate);
  const enriched = await enrichWithPrices(dividends);
  const userHoldings = userId ? await getUserSymbolHolding(userId) : new Map<string, number>();
  const summary = computeSummary(enriched, userHoldings);
  const monthlyIncome = await getMonthlyIncomeProjection(userId);

  return {
    dividends: enriched,
    summary,
    monthlyIncome,
    month,
    year,
  };
}

/**
 * Get all upcoming dividends (exDate >= today).
 */
export async function getUpcomingDividends(
  limit = 50,
  userId?: number
): Promise<DividendEvent[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(Date.UTC(today.getFullYear() + 1, 11, 31, 23, 59, 59, 999));

  const dividends = await fetchDividends(today, endDate, limit);
  return enrichWithPrices(dividends);
}

/**
 * Get monthly income projection for the next 12 months.
 */
export async function getMonthlyIncomeProjection(
  userId?: number
): Promise<MonthlyIncome[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(Date.UTC(today.getFullYear() + 1, 11, 31, 23, 59, 59, 999));

  const dividends = await fetchDividends(today, endDate, 500);
  const enriched = await enrichWithPrices(dividends);
  const userHoldings = userId ? await getUserSymbolHolding(userId) : new Map<string, number>();

  // Group by month
  const monthMap = new Map<string, { income: number; count: number }>();

  for (const d of enriched) {
    if (!d.exDate) continue;
    const date = new Date(d.exDate);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    const existing = monthMap.get(key) || { income: 0, count: 0 };
    const qty = userHoldings.get(d.symbol) || 0;
    existing.income += (d.dividendPerShare || 0) * qty;
    existing.count += 1;
    monthMap.set(key, existing);
  }

  // Convert to array sorted by date
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => {
      const [y, m] = key.split("-").map(Number);
      return {
        month: m,
        year: y,
        label: `${monthNames[m - 1]} ${y}`,
        income: val.income,
        count: val.count,
      };
    });
}

/**
 * Get dividend summary stats.
 */
export function computeSummary(
  dividends: DividendEvent[],
  userHoldings: Map<string, number>
): DividendSummary {
  const now = new Date();
  const upcoming = dividends.filter((d) => d.exDate && new Date(d.exDate) >= now);

  let estMonthlyIncome = 0;
  let estAnnualIncome = 0;
  let totalYield = 0;
  let yieldCount = 0;

  for (const d of upcoming) {
    const qty = userHoldings.get(d.symbol) || 0;
    const income = (d.dividendPerShare || 0) * qty;
    const isNextMonth =
      d.exDate &&
      new Date(d.exDate).getMonth() === (now.getMonth() + 1) % 12 &&
      new Date(d.exDate).getFullYear() ===
        (now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear());
    if (isNextMonth) estMonthlyIncome += income;
    estAnnualIncome += income;
    if (d.dividendYield !== null && d.dividendYield !== undefined) {
      totalYield += d.dividendYield;
      yieldCount++;
    }
  }

  return {
    upcomingCount: upcoming.length,
    estMonthlyIncome,
    estAnnualIncome,
    avgYield: yieldCount > 0 ? totalYield / yieldCount : null,
    totalDividends: dividends.length,
  };
}

/* ─── Internal Helpers ─── */

async function fetchDividends(
  startDate: Date,
  endDate: Date,
  limit?: number
): Promise<DividendEvent[]> {
  const where = {
    actionType: "DIVIDEND",
    exDate: {
      gte: startDate,
      lte: endDate,
    },
  };

  try {
    const records = await prisma.corporateAction.findMany({
      where,
      orderBy: { exDate: "asc" },
      take: limit,
      select: {
        id: true,
        symbol: true,
        companyName: true,
        exDate: true,
        recordDate: true,
        dividendPerShare: true,
        dividendYield: true,
        faceValue: true,
        ratio: true,
        actionType: true,
        source: true,
        isin: true,
      },
    });

    return records.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      companyName: r.companyName,
      exDate: r.exDate?.toISOString() ?? null,
      recordDate: r.recordDate?.toISOString() ?? null,
      dividendPerShare: r.dividendPerShare ? Number(r.dividendPerShare) : null,
      dividendYield: r.dividendYield ? Number(r.dividendYield) : null,
      currentPrice: null,
      faceValue: r.faceValue,
      ratio: r.ratio,
      actionType: r.actionType,
      source: r.source,
      isin: r.isin,
    }));
  } catch (error) {
    logger.error({ msg: "Failed to fetch dividends", error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async function enrichWithPrices(dividends: DividendEvent[]): Promise<DividendEvent[]> {
  const uniqueSymbols = [...new Set(dividends.map((d) => d.symbol).filter(Boolean))];
  if (uniqueSymbols.length === 0) return dividends;

  let priceMap = new Map<string, number | null>();

  try {
    type PriceRow = { ticker: string; close: number };
    const priceRows = await prisma.$queryRaw<PriceRow[]>`
      SELECT DISTINCT ON (ticker) ticker, close::float8 as close
      FROM daily_prices
      WHERE ticker = ANY(${uniqueSymbols})
      ORDER BY ticker, "tradeDate" DESC
    `;
    for (const row of priceRows) {
      priceMap.set(row.ticker, row.close);
    }
  } catch (error) {
    logger.warn({ msg: "Failed to fetch prices for dividend enrichment", error: error instanceof Error ? error.message : String(error) });
  }

  return dividends.map((d) => {
    const currentPrice = priceMap.get(d.symbol) ?? null;
    return {
      ...d,
      currentPrice,
      dividendYield:
        d.dividendPerShare && currentPrice && currentPrice > 0
          ? (d.dividendPerShare / currentPrice) * 100
          : d.dividendYield,
    };
  });
}

/**
 * Get the quantity held by a user for each symbol.
 * Holdings are computed dynamically from BUY/SELL transactions.
 */
async function getUserSymbolHolding(userId: number): Promise<Map<string, number>> {
  try {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId },
      include: {
        transactions: {
          select: { ticker: true, side: true, quantity: true },
        },
      },
    });

    const holdingMap = new Map<string, number>();

    for (const portfolio of portfolios) {
      for (const tx of portfolio.transactions) {
        const qty = Number(tx.quantity);
        const current = holdingMap.get(tx.ticker) || 0;
        if (tx.side === "BUY") {
          holdingMap.set(tx.ticker, current + qty);
        } else if (tx.side === "SELL") {
          holdingMap.set(tx.ticker, Math.max(0, current - qty));
        }
      }
    }

    return holdingMap;
  } catch (error) {
    logger.warn({ msg: "Failed to fetch user holdings for dividend estimation", error: error instanceof Error ? error.message : String(error) });
    return new Map();
  }
}
