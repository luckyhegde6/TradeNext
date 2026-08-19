// lib/services/intelligence/adapters.ts — NSE data adapters for Intelligence
// Each adapter fetches from NSE (with existing caching layers) and maps to IntelligenceInput fields.
// All adapters return null on failure — never throw.

import logger from "@/lib/logger";
import { getStockQuote } from "@/lib/stock-service";
import { fetchCorporateActions, fetchCorporateAnnouncements, fetchSecurityWiseHistoricalData, securityWiseBarsToOHLCV } from "@/lib/nse-api";
import { computeSMA, computeEMA, computeRSI, computeMACD, computeBollinger, computeATR, findSupportResistance } from "@/lib/screener/technical-analysis";
import type {
  QuoteData,
  TechnicalsData,
  ValuationData,
  FundamentalsData,
  ShareholdingData,
  CorporateData,
  NewsData,
  PeersData,
} from "../intelligenceTypes";

// ─── 1. Quote Data ──────────────────────────────────────────────────────────

export async function fetchQuoteData(symbol: string): Promise<QuoteData | null> {
  try {
    const quote = await getStockQuote(symbol);
    if (!quote) return null;

    return {
      symbol: quote.symbol,
      price: quote.lastPrice,
      change: quote.change,
      percentChange: quote.pChange,
      pe: quote.peRatio,
      pb: null, // unavailable from quote
      marketCap: quote.marketCap,
      fiftyTwoWeekHigh: quote.yearHigh,
      fiftyTwoWeekLow: quote.yearLow,
      volume: quote.totalTradedVolume,
      vwAP: null, // unavailable from quote
      sector: quote.sector,
      industry: quote.industry,
      faceValue: null, // unavailable from quote
      bookValue: null, // unavailable from quote
      eps: null, // unavailable from quote
      dividendYield: null, // unavailable from quote
    };
  } catch (err) {
    logger.warn({ msg: "Quote adapter failed", symbol, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── 2. Technicals Data ──────────────────────────────────────────────────────

export async function fetchTechnicalsData(symbol: string): Promise<TechnicalsData | null> {
  try {
    // Fetch 90-day bars for indicator computation
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 90);

    const rawBars = await fetchSecurityWiseHistoricalData(
      symbol,
      formatDate(from),
      formatDate(to),
      "EQ"
    );

    const bars = securityWiseBarsToOHLCV(rawBars);
    if (bars.length < 15) return null;

    const closes = bars.map((b) => b.close);
    const currentPrice = closes[closes.length - 1];

    // Compute indicators
    const sma20 = computeSMA(closes, 20);
    const sma50 = computeSMA(closes, 50);
    const ema12 = computeEMA(closes, 12);
    const ema26 = computeEMA(closes, 26);
    const rsi = computeRSI(closes, 14);
    const macd = computeMACD(closes);
    const bollinger = computeBollinger(closes);
    const atr = computeATR(bars, 14);
    const sr = findSupportResistance(bars, 5);

    // Trend determination
    const sma20Val = lastOrUndefined(sma20);
    const sma50Val = lastOrUndefined(sma50);
    const currentTrend: TechnicalsData["currentTrend"] =
      sma20Val && sma50Val
        ? currentPrice > sma20Val && sma20Val > sma50Val
          ? "UPTREND"
          : currentPrice < sma20Val && sma20Val < sma50Val
            ? "DOWNTREND"
            : "SIDEWAYS"
        : "SIDEWAYS";

    // Trend strength
    const rsiVal = lastOrUndefined(rsi);
    const trendStrength =
      rsiVal !== undefined
        ? rsiVal > 70
          ? "Overbought"
          : rsiVal > 60
            ? "Bullish"
            : rsiVal > 40
              ? "Neutral"
              : rsiVal > 30
                ? "Bearish"
                : "Oversold"
        : "Unknown";

    // Indicator summary
    const indicators: string[] = [];
    if (rsiVal !== undefined) indicators.push(`RSI ${rsiVal.toFixed(1)}`);
    if (sma20Val) indicators.push(`SMA20 ₹${sma20Val.toFixed(0)}`);
    if (sma50Val) indicators.push(`SMA50 ₹${sma50Val.toFixed(0)}`);
    const macdVal = lastOrUndefined(macd.macd);
    if (macdVal !== undefined) indicators.push(`MACD ${macdVal.toFixed(2)}`);

    return {
      currentTrend,
      sma20: sma20Val ?? null,
      sma50: sma50Val ?? null,
      sma200: null, // need 250+ bars for SMA200
      ema12: lastOrUndefined(ema12) ?? null,
      ema26: lastOrUndefined(ema26) ?? null,
      rsi14: rsiVal ?? null,
      macdLine: macdVal ?? null,
      macdSignal: lastOrUndefined(macd.signal) ?? null,
      macdHistogram: lastOrUndefined(macd.histogram) ?? null,
      bollingerUpper: lastOrUndefined(bollinger.upper) ?? null,
      bollingerMiddle: lastOrUndefined(bollinger.middle) ?? null,
      bollingerLower: lastOrUndefined(bollinger.lower) ?? null,
      atr14: lastOrUndefined(atr) ?? null,
      support: sr.support,
      resistance: sr.resistance,
      trendStrength,
      indicatorSummary: indicators.join(" | "),
    };
  } catch (err) {
    logger.warn({ msg: "Technicals adapter failed", symbol, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── 3. Valuation Data ───────────────────────────────────────────────────────

export async function fetchValuationData(symbol: string): Promise<ValuationData | null> {
  try {
    const quote = await getStockQuote(symbol);
    if (!quote) return null;

    const pe = quote.peRatio;
    const pb = null; // unavailable from quote
    const evEbitda = pe > 0 ? pe * 0.7 : null; // rough proxy

    return {
      pe,
      pb,
      evEbitda,
      peg: null, // needs earnings growth
      dividendYield: null, // unavailable from quote
      sectorMedianPe: null, // needs sector data
      relativeValue: pe !== null ? (pe < 15 ? "Undervalued" : pe < 25 ? "Fairly valued" : "Overvalued") : "Unknown",
      valuationAssessment: "Based on P/E ratio relative to market average",
    };
  } catch (err) {
    logger.warn({ msg: "Valuation adapter failed", symbol, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── 4. Fundamentals Data ────────────────────────────────────────────────────

export async function fetchFundamentalsData(symbol: string): Promise<FundamentalsData | null> {
  try {
    // Fundamentals require financial data not available from quote alone
    // Return minimal data from what's available
    return {
      creditRating: null,
      interestCoverage: null,
      debtToEquity: null,
      roce: null,
      roe: null,
      netWorth: null,
      totalDebt: null,
      quarterlyResults: [],
      profitTrend: "Unknown",
      revenueTrend: "Unknown",
      workingCapitalTrend: "Unknown",
    };
  } catch (err) {
    logger.warn({ msg: "Fundamentals adapter failed", symbol, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── 5. Shareholding Data ────────────────────────────────────────────────────

export async function fetchShareholdingData(_symbol: string): Promise<ShareholdingData | null> {
  // Shareholding pattern requires a separate NSE endpoint not currently available
  return null;
}

// ─── 6. Corporate Data ───────────────────────────────────────────────────────

export async function fetchCorporateData(symbol: string): Promise<CorporateData | null> {
  try {
    const [actions, announcements] = await Promise.allSettled([
      fetchCorporateActions({ symbol }),
      fetchCorporateAnnouncements({ symbol }),
    ]);

    const recentActions =
      actions.status === "fulfilled"
        ? actions.value
            .filter((a) => a.symbol?.toUpperCase() === symbol.toUpperCase())
            .slice(0, 10)
            .map((a) => ({
              type: a.subject.includes("Dividend")
                ? "dividend"
                : a.subject.includes("Bonus")
                  ? "bonus"
                  : a.subject.includes("Split")
                    ? "split"
                    : "other",
              date: a.exDate || a.recordDate || "",
              details: a.subject,
            }))
        : [];

    const upcomingEvents = recentActions.slice(0, 5); // reuse recent as upcoming

    const keyAnnouncements =
      announcements.status === "fulfilled"
        ? announcements.value.slice(0, 5).map((a) => ({
            title: a.desc || "Announcement",
            date: a.an_dt || "",
            category: "corporate",
          }))
        : [];

    const governanceSignals: string[] = [];

    return { recentActions, upcomingEvents, keyAnnouncements, governanceSignals };
  } catch (err) {
    logger.warn({ msg: "Corporate adapter failed", symbol, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── 7. News Data ────────────────────────────────────────────────────────────

export async function fetchNewsData(_symbol: string): Promise<NewsData | null> {
  // News requires a separate NSE endpoint not currently available
  return null;
}

// ─── 8. Peers Data ───────────────────────────────────────────────────────────

export async function fetchPeersData(_symbol: string): Promise<PeersData | null> {
  // Peers require sector-based stock list which is available but not yet wired
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lastOrUndefined(arr: number[]): number | undefined {
  return arr.length > 0 ? arr[arr.length - 1] : undefined;
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
