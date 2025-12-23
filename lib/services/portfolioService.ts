import prisma from "@/lib/prisma";
import { getStockQuote } from "@/lib/stock-service";
import logger from "@/lib/logger";
import { enhancedCache } from "@/lib/enhanced-cache";
import { getRecommendedTTL } from "@/lib/market-hours";

export interface Holding {
  ticker: string;
  name?: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  investedValue: number;
  pnl: number;
  pnlPercent: number;
  allocation: number;
  dayChange?: number;
  dayChangePercent?: number;
  yearHigh?: number;
  yearLow?: number;
  peRatio?: number;
  sector?: string;
  industry?: string;
  isin?: string;
  highLowProgress?: number;
  marketAveragePrice?: number;
  closePrice?: number;
}

export interface PortfolioSummary {
  id?: string;
  name?: string;
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPercent: number;
  todayChange: number;
  todayChangePercent: number;
  holdings: Holding[];
  hasPortfolio: boolean;
}


export async function getPortfolioData(userId: number): Promise<PortfolioSummary> {
  const cacheKey = `portfolio:data:${userId}`;

  // Dynamic TTL: 5 minutes if market open, otherwise until next open
  const ttl = Math.floor(getRecommendedTTL(300000) / 1000);

  return enhancedCache.getWithCache({
    key: cacheKey,
    ttl: ttl,
  }, async () => {
    const portfolio = await prisma.portfolio.findFirst({
      where: { userId },
      include: {
        transactions: true,
        fundTransactions: true,
      },
    });

    if (!portfolio) {
      return {
        totalValue: 0,
        totalInvested: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        todayChange: 0,
        todayChangePercent: 0,
        holdings: [],
        hasPortfolio: false,
      };
    }

    // Group transactions by ticker
    const holdingsMap = new Map<string, { quantity: number; totalCost: number }>();

    const transactions = (portfolio as any).transactions || [];

    transactions.forEach((tx: any) => {
      const current = holdingsMap.get(tx.ticker) || { quantity: 0, totalCost: 0 };
      if (tx.side === 'BUY') {
        current.quantity += Number(tx.quantity);
        current.totalCost += Number(tx.quantity) * Number(tx.price);
      } else if (tx.side === 'SELL') {
        const avgCost = current.quantity > 0 ? (current.totalCost / current.quantity) : 0;
        current.quantity -= Number(tx.quantity);
        current.totalCost -= Number(tx.quantity) * avgCost;
      }

      if (current.quantity > 0.000001) {
        holdingsMap.set(tx.ticker, current);
      } else {
        holdingsMap.delete(tx.ticker);
      }
    });

    const tickers = Array.from(holdingsMap.keys());

    // Fetch latest prices from DailyPrice as baseline/fallback
    const dbPrices = await prisma.dailyPrice.findMany({
      where: {
        ticker: { in: tickers },
      },
      orderBy: { tradeDate: 'desc' },
      distinct: ['ticker'],
    });

    const dbPriceMap = new Map<string, number>(dbPrices.map((p: any) => [p.ticker, Number(p.close || 0)]));

    // Optimized Parallel Enrichment with NSE Real-time Data
    const enrichedHoldings: Holding[] = await Promise.all(tickers.map(async (ticker: string) => {
      const h = holdingsMap.get(ticker)!;
      let currentPrice: number = dbPriceMap.get(ticker) || 0;
      let dayChange = 0;
      let dayChangePercent = 0;
      let name = ticker;
      let yearHigh = 0;
      let yearLow = 0;
      let peRatio = 0;
      let sector = '';
      let industry = '';
      let isin = '';
      let marketAveragePrice = 0;
      let closePrice = 0;

      try {
        const quote = await getStockQuote(ticker);
        if (quote) {
          currentPrice = quote.lastPrice || currentPrice;
          dayChange = quote.change;
          dayChangePercent = quote.pChange;
          name = quote.companyName;
          yearHigh = quote.yearHigh;
          yearLow = quote.yearLow;
          peRatio = quote.peRatio;
          sector = quote.sector;
          industry = quote.industry;
          isin = quote.isinCode;
          marketAveragePrice = quote.averagePrice;
          closePrice = quote.closePrice;
        }
      } catch (err) {
        logger.warn({ msg: 'Live price fetch failed for portfolio', ticker, error: err });
      }

      if (currentPrice === 0) {
        currentPrice = h.totalCost / h.quantity;
      }

      const currentValue = h.quantity * currentPrice;
      const investedValue = h.totalCost;
      const pnl = currentValue - investedValue;
      const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;

      // Calculation: 52w Range Progress
      let highLowProgress = 0;
      if (yearHigh > yearLow) {
        highLowProgress = ((currentPrice - yearLow) / (yearHigh - yearLow)) * 100;
      }

      return {
        ticker,
        name,
        quantity: h.quantity,
        avgPrice: h.totalCost / h.quantity,
        currentPrice,
        currentValue,
        investedValue,
        pnl,
        pnlPercent,
        allocation: 0,
        dayChange,
        dayChangePercent,
        yearHigh,
        yearLow,
        peRatio,
        sector,
        industry,
        isin,
        highLowProgress,
        marketAveragePrice,
        closePrice
      };
    }));

    const totalValue = enrichedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
    const totalInvested = enrichedHoldings.reduce((sum, h) => sum + h.investedValue, 0);
    const totalPnl = totalValue - totalInvested;
    const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    const totalTodayChange = enrichedHoldings.reduce((sum, h) => sum + (h.dayChange || 0) * h.quantity, 0);
    const totalPrevValue = totalValue - totalTodayChange;
    const totalTodayChangePercent = totalPrevValue > 0 ? (totalTodayChange / totalPrevValue) * 100 : 0;

    enrichedHoldings.forEach(h => {
      h.allocation = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
    });

    return {
      id: portfolio.id,
      name: portfolio.name,
      totalValue,
      totalInvested,
      totalPnl,
      totalPnlPercent,
      todayChange: totalTodayChange,
      todayChangePercent: totalTodayChangePercent,
      holdings: enrichedHoldings,
      hasPortfolio: true,
    };
  });
}

export function invalidatePortfolioCache(userId: number) {
  const cacheKey = `portfolio:data:${userId}`;
  enhancedCache.invalidate(cacheKey);
}
