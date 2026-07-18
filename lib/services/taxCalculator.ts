/**
 * Tax Calculator — FIFO-based capital gains computation for Indian equities.
 *
 * Indian Tax Rules (STT-paid listed equities):
 * - Short Term: Holding ≤ 12 months → 15% tax
 * - Long Term: Holding > 12 months → 10% tax on gains over ₹1L
 *
 * FIFO Matching: Each SELL is matched against the oldest BUY lots.
 */

export interface TaxTradeInput {
  tradeDate: Date;
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fees?: number;
}

export interface TaxLot {
  ticker: string;
  buyDate: Date;
  buyPrice: number;
  remainingQty: number;
}

export interface ComputedTrade {
  symbol: string;
  buyDate: string;
  sellDate: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  buyValue: number;
  sellValue: number;
  gain: number;
  gainPercent: number;
  holdingDays: number;
  type: "STCG" | "LTCG";
  taxRate: number;
  taxEstimate: number;
}

export interface TaxSummary {
  totalSTCG: number;
  totalLTCG: number;
  taxableLTCG: number; // after ₹1L exemption
  totalGain: number;
  totalLoss: number;
  netGain: number;
  estSTTax: number;
  estLTTax: number;
  totalTaxEstimate: number;
  totalTrades: number;
  stcgTrades: number;
  ltcgTrades: number;
}

/* ─── Constants ─── */

const STCG_DAYS = 365; // 12 months for equities
const STCG_RATE = 0.15; // 15%
const LTCG_RATE = 0.10; // 10%
const LTCG_EXEMPTION = 100_000; // ₹1,00,000

/* ─── Config ─── */

export interface TaxConfig {
  stcgRate: number;
  ltcgRate: number;
  ltcgExemption: number;
  stcgDays: number;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  stcgRate: STCG_RATE,
  ltcgRate: LTCG_RATE,
  ltcgExemption: LTCG_EXEMPTION,
  stcgDays: STCG_DAYS,
};

/* ─── Core Functions ─── */

/**
 * Compute capital gains from a list of trades using FIFO method.
 */
export function computeCapitalGains(
  trades: TaxTradeInput[],
  config: TaxConfig = DEFAULT_TAX_CONFIG
): { trades: ComputedTrade[]; summary: TaxSummary } {
  // Sort chronologically
  const sorted = [...trades].sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());

  // Separate and group by symbol
  const buysBySymbol = new Map<string, TaxLot[]>();
  const computedTrades: ComputedTrade[] = [];

  for (const trade of sorted) {
    const sym = trade.ticker.toUpperCase();

    if (trade.side === "BUY") {
      if (!buysBySymbol.has(sym)) buysBySymbol.set(sym, []);
      buysBySymbol.get(sym)!.push({
        ticker: sym,
        buyDate: trade.tradeDate,
        buyPrice: trade.price,
        remainingQty: trade.quantity,
      });
    } else if (trade.side === "SELL") {
      let sellQty = trade.quantity;
      const lots = buysBySymbol.get(sym) || [];

      // Also track lots that weren't fully matched (still held)
      while (sellQty > 0 && lots.length > 0) {
        const lot = lots[0];

        const matchQty = Math.min(sellQty, lot.remainingQty);
        if (matchQty <= 0) {
          lots.shift();
          continue;
        }

        const holdingDays = Math.floor(
          (trade.tradeDate.getTime() - lot.buyDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const type = holdingDays <= config.stcgDays ? "STCG" : "LTCG";
        const buyValue = lot.buyPrice * matchQty;
        const sellValue = trade.price * matchQty;
        const gain = sellValue - buyValue;
        const gainPercent = buyValue > 0 ? (gain / buyValue) * 100 : 0;
        const taxRate = type === "STCG" ? config.stcgRate : config.ltcgRate;

        computedTrades.push({
          symbol: sym,
          buyDate: lot.buyDate.toISOString().split("T")[0],
          sellDate: trade.tradeDate.toISOString().split("T")[0],
          quantity: matchQty,
          buyPrice: lot.buyPrice,
          sellPrice: trade.price,
          buyValue,
          sellValue,
          gain,
          gainPercent,
          holdingDays,
          type,
          taxRate,
          taxEstimate: 0, // computed later
        });

        lot.remainingQty -= matchQty;
        sellQty -= matchQty;

        if (lot.remainingQty <= 0) {
          lots.shift();
        }
      }

      // If sellQty > 0 after exhausting lots, it's a short sell or stale position
      if (sellQty > 0) {
        // Create an unmatched trade with undefined buy info
        computedTrades.push({
          symbol: sym,
          buyDate: "—",
          sellDate: trade.tradeDate.toISOString().split("T")[0],
          quantity: sellQty,
          buyPrice: 0,
          sellPrice: trade.price,
          buyValue: 0,
          sellValue: trade.price * sellQty,
          gain: trade.price * sellQty,
          gainPercent: 0,
          holdingDays: 0,
          type: "STCG",
          taxRate: config.stcgRate,
          taxEstimate: 0,
        });
      }
    }
  }

  // Compute summary
  const summary = computeSummary(computedTrades, config);
  return { trades: computedTrades, summary };
}

/**
 * Compute tax summary from computed trades.
 */
export function computeSummary(
  computedTrades: ComputedTrade[],
  config: TaxConfig = DEFAULT_TAX_CONFIG
): TaxSummary {
  let totalSTCG = 0;
  let totalLTCG = 0;
  let stcgTrades = 0;
  let ltcgTrades = 0;

  for (const trade of computedTrades) {
    if (trade.type === "STCG") {
      totalSTCG += trade.gain;
      stcgTrades++;
    } else {
      totalLTCG += trade.gain;
      ltcgTrades++;
    }
  }

  // LTCG is taxable only above ₹1L
  const taxableLTCG = Math.max(0, totalLTCG - config.ltcgExemption);

  const estSTTax = Math.max(0, totalSTCG) * config.stcgRate;
  const estLTTax = Math.max(0, taxableLTCG) * config.ltcgRate;

  // Assign tax estimates to individual trades
  for (const trade of computedTrades) {
    if (trade.type === "STCG") {
      trade.taxEstimate = Math.max(0, trade.gain) * config.stcgRate;
    } else {
      // Prorate LTCG exemption across all LTCG trades
      const ltcgRatio = totalLTCG > 0 ? trade.gain / totalLTCG : 0;
      const taxablePortion = Math.max(0, trade.gain - config.ltcgExemption * ltcgRatio);
      trade.taxEstimate = taxablePortion * config.ltcgRate;
    }
  }

  return {
    totalSTCG: Math.round(totalSTCG * 100) / 100,
    totalLTCG: Math.round(totalLTCG * 100) / 100,
    taxableLTCG: Math.round(taxableLTCG * 100) / 100,
    totalGain: Math.round((totalSTCG + totalLTCG) * 100) / 100,
    totalLoss: 0,
    netGain: Math.round((totalSTCG + totalLTCG) * 100) / 100,
    estSTTax: Math.round(estSTTax * 100) / 100,
    estLTTax: Math.round(estLTTax * 100) / 100,
    totalTaxEstimate: Math.round((estSTTax + estLTTax) * 100) / 100,
    totalTrades: computedTrades.length,
    stcgTrades,
    ltcgTrades,
  };
}

/**
 * Determine financial year from a date.
 * Indian financial year: Apr 1 to Mar 31.
 * Returns string like "2025-26".
 */
export function getFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  if (month >= 3) {
    // Apr-Dec: FY starts this year
    return `${year}-${(year + 1).toString().slice(-2)}`;
  } else {
    // Jan-Mar: FY ends this year
    return `${year - 1}-${year.toString().slice(-2)}`;
  }
}

/**
 * Get date range for a financial year.
 */
export function getFYDateRange(fy: string): { start: Date; end: Date } {
  const [startYear] = fy.split("-").map((s) => parseInt(s, 10) || parseInt(fy, 10));
  const fyStart = parseInt(String(startYear), 10);
  return {
    start: new Date(fyStart, 3, 1), // Apr 1
    end: new Date(fyStart + 1, 2, 31, 23, 59, 59, 999), // Mar 31
  };
}

/**
 * List of recent financial years.
 */
export function getFinancialYears(): string[] {
  const now = new Date();
  const currentFY = getFinancialYear(now);
  const currentStart = parseInt(currentFY.split("-")[0], 10);
  const years: string[] = [];
  for (let i = 0; i < 5; i++) {
    const y = currentStart - i;
    years.push(`${y}-${(y + 1).toString().slice(-2)}`);
  }
  return years;
}
