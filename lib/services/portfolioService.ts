// lib/services/portfolioService.ts
export interface Holding {
  ticker: string;
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
}

export interface PortfolioSummary {
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPercent: number;
  todayChange: number;
  todayChangePercent: number;
  holdings: Holding[];
}

// Demo data - replace with actual API calls to Google Finance
const DEMO_CURRENT_PRICES: Record<string, number> = {
  'TCS': 3610,
  'INFY': 1510,
  'RELIANCE': 2450,
  'HDFCBANK': 1650,
  'ICICIBANK': 1120,
};

export async function getPortfolioData(): Promise<PortfolioSummary> {
  // Demo holdings - in production, fetch from Prisma Transaction model
  const holdings = [
    { ticker: 'TCS', quantity: 10, avgPrice: 3500 },
    { ticker: 'INFY', quantity: 20, avgPrice: 1400 },
    { ticker: 'RELIANCE', quantity: 15, avgPrice: 2300 },
    { ticker: 'HDFCBANK', quantity: 25, avgPrice: 1580 },
    { ticker: 'ICICIBANK', quantity: 30, avgPrice: 1050 },
  ];

  // Calculate metrics for each holding
  const enrichedHoldings: Holding[] = holdings.map(h => {
    const currentPrice = DEMO_CURRENT_PRICES[h.ticker] || h.avgPrice;
    const currentValue = h.quantity * currentPrice;
    const investedValue = h.quantity * h.avgPrice;
    const pnl = currentValue - investedValue;
    const pnlPercent = (pnl / investedValue) * 100;

    return {
      ticker: h.ticker,
      quantity: h.quantity,
      avgPrice: h.avgPrice,
      currentPrice,
      currentValue,
      investedValue,
      pnl,
      pnlPercent,
      allocation: 0, // Will be calculated below
      dayChange: currentPrice * 0.01 * (Math.random() > 0.5 ? 1 : -1), // Demo
      dayChangePercent: (Math.random() * 3 - 1.5), // Demo: -1.5% to +1.5%
    };
  });

  // Calculate total values
  const totalValue = enrichedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
  const totalInvested = enrichedHoldings.reduce((sum, h) => sum + h.investedValue, 0);
  const totalPnl = totalValue - totalInvested;
  const totalPnlPercent = (totalPnl / totalInvested) * 100;

  // Calculate allocation percentages
  enrichedHoldings.forEach(h => {
    h.allocation = (h.currentValue / totalValue) * 100;
  });

  // Calculate today's change (demo)
  const todayChange = enrichedHoldings.reduce((sum, h) => 
    sum + (h.dayChange || 0) * h.quantity, 0
  );
  const todayChangePercent = (todayChange / totalValue) * 100;

  return {
    totalValue,
    totalInvested,
    totalPnl,
    totalPnlPercent,
    todayChange,
    todayChangePercent,
    holdings: enrichedHoldings,
  };
}
