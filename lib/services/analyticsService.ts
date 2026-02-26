import { prisma } from "@/lib/prisma";
import logger from "@/lib/logger";

export interface PortfolioAnalytics {
  totalValue: number;
  totalInvested: number;
  totalGain: number;
  totalGainPercent: number;
  dayChange: number;
  dayChangePercent: number;
  holdings: HoldingAnalytics[];
}

export interface HoldingAnalytics {
  ticker: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  gain: number;
  gainPercent: number;
  dayChange: number;
  dayChangePercent: number;
  weight: number;
}

export interface MarketAnalytics {
  gainers: StockAnalytics[];
  losers: StockAnalytics[];
  mostActive: StockAnalytics[];
  advanceDecline: AdvanceDecline;
}

export interface StockAnalytics {
  ticker: string;
  name?: string;
  lastPrice: number;
  change: number;
  pChange: number;
  volume: bigint;
  value?: number;
}

export interface AdvanceDecline {
  advances: number;
  declines: number;
  unchanged: number;
}

export async function getPortfolioAnalytics(
  portfolioId: string,
  userId: number
): Promise<PortfolioAnalytics | null> {
  logger.info({ msg: "Getting portfolio analytics", portfolioId, userId });

  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, userId },
    include: {
      transactions: {
        where: { ticker: { not: "" } },
      },
      fundTransactions: true,
    },
  });

  if (!portfolio) {
    return null;
  }

  const holdingsMap = new Map<
    string,
    { quantity: number; totalCost: number; trades: typeof portfolio.transactions }
  >();

  let totalFundDeposits = 0;
  let totalFundWithdrawals = 0;

  for (const tx of portfolio.fundTransactions) {
    if (tx.type === "DEPOSIT") {
      totalFundDeposits += Number(tx.amount);
    } else {
      totalFundWithdrawals += Number(tx.amount);
    }
  }

  for (const tx of portfolio.transactions) {
    const qty = Number(tx.quantity);
    const cost = qty * Number(tx.price);
    const existing = holdingsMap.get(tx.ticker) || { quantity: 0, totalCost: 0, trades: [] };

    if (tx.side === "BUY") {
      existing.quantity += qty;
      existing.totalCost += cost + Number(tx.fees || 0);
    } else {
      existing.quantity -= qty;
      existing.totalCost -= cost - Number(tx.fees || 0);
    }

    if (existing.quantity > 0) {
      holdingsMap.set(tx.ticker, existing);
    } else {
      holdingsMap.delete(tx.ticker);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tickers = Array.from(holdingsMap.keys());
  const prices = await prisma.dailyPrice.findMany({
    where: {
      ticker: { in: tickers },
      tradeDate: { gte: today },
    },
  });

  const priceMap = new Map<string, { close: number; open: number }>();
  for (const p of prices) {
    priceMap.set(p.ticker, { close: Number(p.close), open: Number(p.open) });
  }

  const previousPrices = await prisma.dailyPrice.findMany({
    where: {
      ticker: { in: tickers },
      tradeDate: {
        lt: today,
        gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { tradeDate: "desc" },
  });

  const prevPriceMap = new Map<string, number>();
  for (const p of previousPrices) {
    if (!prevPriceMap.has(p.ticker)) {
      prevPriceMap.set(p.ticker, Number(p.close));
    }
  }

  const holdings: HoldingAnalytics[] = [];
  let totalValue = 0;
  let totalInvested = 0;
  let dayChange = 0;
  let dayChangePrevious = 0;

  for (const [ticker, holding] of holdingsMap) {
    const currentPrice = priceMap.get(ticker)?.close || 0;
    const previousPrice = prevPriceMap.get(ticker) || currentPrice;
    const currentValue = holding.quantity * currentPrice;
    const avgPrice = holding.totalCost / holding.quantity;
    const gain = currentValue - holding.totalCost;
    const gainPercent = holding.totalCost > 0 ? (gain / holding.totalCost) * 100 : 0;
    const holdingDayChange = holding.quantity * (currentPrice - previousPrice);

    totalValue += currentValue;
    totalInvested += holding.totalCost;
    dayChange += holdingDayChange;
    dayChangePrevious += holding.quantity * previousPrice;

    holdings.push({
      ticker,
      quantity: holding.quantity,
      avgPrice,
      currentPrice,
      currentValue,
      gain,
      gainPercent,
      dayChange: holdingDayChange,
      dayChangePercent: previousPrice > 0 ? ((currentPrice - previousPrice) / previousPrice) * 100 : 0,
      weight: 0,
    });
  }

  for (const h of holdings) {
    h.weight = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
  }

  const totalGain = totalValue - totalInvested;
  const totalGainPercent = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
  const dayChangePercent = dayChangePrevious > 0 ? (dayChange / dayChangePrevious) * 100 : 0;

  return {
    totalValue,
    totalInvested,
    totalGain,
    totalGainPercent,
    dayChange,
    dayChangePercent,
    holdings: holdings.sort((a, b) => b.currentValue - a.currentValue),
  };
}

export async function getMarketAnalytics(): Promise<MarketAnalytics> {
  logger.info({ msg: "Getting market analytics" });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const prices = await prisma.dailyPrice.findMany({
    where: { tradeDate: { gte: today } },
    orderBy: { volume: "desc" },
    take: 100,
  });

  const tickers = prices.map((p) => p.ticker);

  const previousPrices = await prisma.dailyPrice.findMany({
    where: {
      ticker: { in: tickers },
      tradeDate: {
        lt: today,
        gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { tradeDate: "desc" },
  });

  const prevPriceMap = new Map<string, number>();
  for (const p of previousPrices) {
    if (!prevPriceMap.has(p.ticker)) {
      prevPriceMap.set(p.ticker, Number(p.close));
    }
  }

  const stockAnalytics: StockAnalytics[] = prices.slice(0, 50).map((p) => {
    const currentPrice = Number(p.close);
    const previousPrice = prevPriceMap.get(p.ticker) || currentPrice;
    const change = currentPrice - previousPrice;
    const pChange = previousPrice > 0 ? (change / previousPrice) * 100 : 0;

    return {
      ticker: p.ticker,
      lastPrice: currentPrice,
      change,
      pChange,
      volume: p.volume || BigInt(0),
    };
  });

  const gainers = [...stockAnalytics]
    .filter((s) => s.pChange > 0)
    .sort((a, b) => b.pChange - a.pChange)
    .slice(0, 10);

  const losers = [...stockAnalytics]
    .filter((s) => s.pChange < 0)
    .sort((a, b) => a.pChange - b.pChange)
    .slice(0, 10);

  const mostActive = [...stockAnalytics]
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, 10);

  const indexQuote = await prisma.indexQuote.findFirst({
    where: { indexName: "NIFTY 50" },
  });

  const advanceDecline: AdvanceDecline = {
    advances: indexQuote ? parseInt(indexQuote.advances as unknown as string) || 0 : 0,
    declines: indexQuote ? parseInt(indexQuote.declines as unknown as string) || 0 : 0,
    unchanged: indexQuote ? parseInt(indexQuote.unchanged as unknown as string) || 0 : 0,
  };

  return {
    gainers,
    losers,
    mostActive,
    advanceDecline,
  };
}

export async function getStockAnalytics(
  ticker: string,
  period: "1D" | "1W" | "1M" | "3M" | "1Y" = "1M"
): Promise<{
  priceHistory: { date: Date; close: number; volume: bigint }[];
  summary: {
    high: number;
    low: number;
    avgVolume: number;
    volatility: number;
  };
}> {
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case "1D":
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "1W":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "1M":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "3M":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "1Y":
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
  }

  const prices = await prisma.dailyPrice.findMany({
    where: {
      ticker,
      tradeDate: { gte: startDate },
    },
    orderBy: { tradeDate: "asc" },
  });

  const priceHistory = prices.map((p) => ({
    date: p.tradeDate,
    close: Number(p.close),
    volume: p.volume || BigInt(0),
  }));

  const closes = priceHistory.map((p) => p.close);
  const volumes = priceHistory.map((p) => Number(p.volume));

  const high = Math.max(...closes, 0);
  const low = Math.min(...closes, 0);
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }

  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 0
      ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
      : 0;
  const volatility = Math.sqrt(variance * 252) * 100;

  return {
    priceHistory,
    summary: {
      high,
      low,
      avgVolume,
      volatility: Math.round(volatility * 100) / 100,
    },
  };
}

export async function getUserEngagementStats(): Promise<{
  totalUsers: number;
  activeUsers: number;
  totalPortfolios: number;
  totalTransactions: number;
}> {
  const [totalUsers, activeUsers, totalPortfolios, totalTransactions] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: {
        portfolios: { some: { transactions: { some: {} } } },
      },
    }),
    prisma.portfolio.count(),
    prisma.transaction.count(),
  ]);

  return {
    totalUsers,
    activeUsers,
    totalPortfolios,
    totalTransactions,
  };
}
