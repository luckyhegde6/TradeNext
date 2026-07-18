/**
 * Portfolio Value History Service
 *
 * Reconstructs daily portfolio value from transaction history + DailyPrice data.
 * Used for "P&L Over Time" chart on the portfolio page.
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export interface PortfolioValuePoint {
  date: string; // YYYY-MM-DD
  value: number;
  invested: number;
}

export interface PortfolioValueHistory {
  portfolioName: string;
  totalInvested: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  history: PortfolioValuePoint[];
  benchmark?: BenchmarkSeries; // NIFTY 50 comparison
}

export interface BenchmarkSeries {
  name: string;
  points: { date: string; value: number }[];
  totalReturn: number;
  totalReturnPercent: number;
}

/**
 * Get portfolio value history over time.
 * Reconstructs holdings at each date point using transaction history,
 * then values them using DailyPrice close prices.
 */
export async function getPortfolioValueHistory(
  userId: number,
  maxPoints: number = 120
): Promise<PortfolioValueHistory> {
  const portfolio = await prisma.portfolio.findFirst({
    where: { userId },
    include: {
      transactions: { orderBy: { tradeDate: "asc" } },
    },
  });

  if (!portfolio || portfolio.transactions.length === 0) {
    return {
      portfolioName: "My Portfolio",
      totalInvested: 0,
      totalValue: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      history: [],
    };
  }

  const tickers = [...new Set(portfolio.transactions.map((t) => t.ticker))];

  // Fetch daily prices for all tickers we hold
  const dailyPrices = await prisma.dailyPrice.findMany({
    where: {
      ticker: { in: tickers },
      close: { not: null },
    },
    select: { ticker: true, tradeDate: true, close: true },
    orderBy: { tradeDate: "asc" },
  });

  // Organize prices by ticker: Map<ticker, Map<dateStr, closePrice>>
  const priceByTickerAndDate = new Map<string, Map<string, number>>();
  for (const dp of dailyPrices) {
    const dateStr = dp.tradeDate.toISOString().split("T")[0];
    let byDate = priceByTickerAndDate.get(dp.ticker);
    if (!byDate) {
      byDate = new Map();
      priceByTickerAndDate.set(dp.ticker, byDate);
    }
    byDate.set(dateStr, Number(dp.close));
  }

  // Build price timeline: all distinct dates across all tickers
  const allDates = new Set<string>();
  for (const [_, byDate] of priceByTickerAndDate) {
    for (const dateStr of byDate.keys()) {
      allDates.add(dateStr);
    }
  }
  // Also add transaction dates
  for (const tx of portfolio.transactions) {
    allDates.add(tx.tradeDate.toISOString().split("T")[0]);
  }

  const sortedDates = Array.from(allDates).sort();
  if (sortedDates.length === 0) {
    return {
      portfolioName: portfolio.name,
      totalInvested: 0,
      totalValue: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      history: [],
    };
  }

  // Holdings tracking: Map<ticker, quantity>
  const holdings = new Map<string, number>();
  const totalCostMap = new Map<string, number>(); // track cost basis

  const history: PortfolioValuePoint[] = [];

  // Track cumulative invested value
  let cumulativeInvested = 0;

  // Process each date in chronological order
  for (const dateStr of sortedDates) {
    const currentDay = new Date(dateStr + "T00:00:00.000Z");

    // Apply transactions that occurred on or before this date
    for (const tx of portfolio.transactions) {
      const txDateStr = tx.tradeDate.toISOString().split("T")[0];
      if (txDateStr === dateStr) {
        const qty = Number(tx.quantity);
        const price = Number(tx.price);
        const currentQty = holdings.get(tx.ticker) || 0;
        const currentCost = totalCostMap.get(tx.ticker) || 0;

        if (tx.side === "BUY") {
          holdings.set(tx.ticker, currentQty + qty);
          totalCostMap.set(tx.ticker, currentCost + qty * price);
          cumulativeInvested += qty * price;
        } else if (tx.side === "SELL") {
          const newQty = currentQty - qty;
          if (newQty <= 0) {
            holdings.delete(tx.ticker);
            totalCostMap.delete(tx.ticker);
            // Reduce invested by the cost basis of sold shares
            const avgCost = currentQty > 0 ? currentCost / currentQty : 0;
            cumulativeInvested -= qty * avgCost;
          } else {
            holdings.set(tx.ticker, newQty);
            const avgCost = currentQty > 0 ? currentCost / currentQty : 0;
            totalCostMap.set(tx.ticker, currentCost - qty * avgCost);
            cumulativeInvested -= qty * avgCost;
          }
        }
      }
    }

    // Calculate portfolio value on this date
    let dayValue = 0;
    let dayInvested = 0;

    for (const [ticker, qty] of holdings) {
      const byDate = priceByTickerAndDate.get(ticker);
      // Find the most recent price <= current date (forward fill)
      const price = findLatestPrice(byDate, dateStr);
      if (price !== null) {
        dayValue += qty * price;
      }
      dayInvested += totalCostMap.get(ticker) || 0;
    }

    // Only add points where we actually have holdings and price data
    if (holdings.size > 0 && dayValue > 0) {
      // Sample: keep every Nth point if we have too many
      if (history.length === 0 || sortedDates.length <= maxPoints || history.length % Math.ceil(sortedDates.length / maxPoints) === 0) {
        history.push({
          date: dateStr,
          value: Math.round(dayValue * 100) / 100,
          invested: Math.round(dayInvested * 100) / 100,
        });
      }
    }
  }

  // Always include the last data point
  const latestValue = history.length > 0 ? history[history.length - 1].value : 0;
  const latestInvested = history.length > 0 ? history[history.length - 1].invested : cumulativeInvested;
  const totalPnl = latestValue - latestInvested;
  const totalPnlPercent = latestInvested > 0 ? (totalPnl / latestInvested) * 100 : 0;

  // Fetch NIFTY 50 benchmark data for the same date range
  let benchmark: BenchmarkSeries | undefined;
  if (history.length > 1) {
    const firstDate = history[0].date;
    const lastDate = history[history.length - 1].date;

    try {
      const indexCloses = await prisma.indexClose.findMany({
        where: {
          indexName: "NIFTY 50",
          asOf: { gte: new Date(firstDate + "T00:00:00.000Z"), lte: new Date(lastDate + "T23:59:59.000Z") },
          close: { not: null },
        },
        orderBy: { asOf: "asc" },
        select: { asOf: true, close: true },
      });

      if (indexCloses.length > 1) {
        const firstClose = Number(indexCloses[0].close);
        const lastClose = Number(indexCloses[indexCloses.length - 1].close);
        const totalReturn = lastClose - firstClose;
        const totalReturnPercent = firstClose > 0 ? (totalReturn / firstClose) * 100 : 0;

        const bmPoints = indexCloses.map((ic) => ({
          date: ic.asOf.toISOString().split("T")[0],
          value: Math.round(Number(ic.close) * 100) / 100,
        }));

        benchmark = {
          name: "NIFTY 50",
          points: bmPoints,
          totalReturn: Math.round(totalReturn * 100) / 100,
          totalReturnPercent: Math.round(totalReturnPercent * 100) / 100,
        };
      }
    } catch (err) {
      logger.warn({
        msg: "Failed to fetch benchmark data",
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    portfolioName: portfolio.name,
    totalInvested: Math.round(latestInvested * 100) / 100,
    totalValue: Math.round(latestValue * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
    history,
    benchmark,
  };
}

/**
 * Find the latest price on or before the given date (forward fill).
 */
function findLatestPrice(
  priceMap: Map<string, number> | undefined,
  dateStr: string
): number | null {
  if (!priceMap || priceMap.size === 0) return null;

  // Check exact date first
  if (priceMap.has(dateStr)) return priceMap.get(dateStr)!;

  // Walk backwards to find the most recent price
  const sortedDates = Array.from(priceMap.keys()).sort();
  for (let i = sortedDates.length - 1; i >= 0; i--) {
    if (sortedDates[i] <= dateStr) {
      return priceMap.get(sortedDates[i])!;
    }
  }

  return null;
}
