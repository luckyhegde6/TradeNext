// lib/nse-api.ts - Unified NSE API Service
// Provides consistent API for both live and historical data fetching

import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { parseNseDate } from "@/lib/utils/date-utils";

// Base URL for NSE
const NSE_BASE = "https://www.nseindia.com";

// =============================================================================
// Types
// =============================================================================

export interface NseApiOptions {
  fromDate?: string;  // DD-MM-YYYY format
  toDate?: string;    // DD-MM-YYYY format
  symbol?: string;
  index?: string;
}

export interface AdvanceDeclineData {
  advances: number;
  declines: number;
  unchanged: number;
  total: number;
  stocks: {
    symbol: string;
    lastPrice: number;
    pchange: number;
    change: number;
    previousClose: number;
    identifier: "Advances" | "Declines" | "Unchanged";
  }[];
}

export interface CorporateAction {
  symbol: string;
  companyName: string;
  series: string;
  faceValue: string;
  subject: string;
  exDate: string;
  recordDate: string;
  bcStartDate?: string;
  bcEndDate?: string;
  ndStartDate?: string;
  ndEndDate?: string;
  promoterHolding?: string;
}

export interface CorporateAnnouncement {
  symbol: string;
  companyName: string;
  desc: string;
  attchmntText?: string;
  attchmntFile?: string;
  attFileSize?: string;
  hasXbrl?: boolean;
  an_dt: string;
}

export interface EventCalendarItem {
  symbol: string;
  company: string;
  purpose: string;
  date: string;
  bm_desc?: string;
  details?: string;
}

export interface DealData {
  symbol: string;
  clientName: string;
  quantity: number;
  price: number;
  buySell: string;
  dealDate?: string;
}

export interface VolumeAnalysisData {
  symbol: string;
  lastPrice: number;
  tradedQuantity: number;
  turnover: number;
 adar?: number;
}

// =============================================================================
// Security-Wise Historical Data (generateSecurityWiseHistoricalData)
// =============================================================================

/** Single row from NSE's generateSecurityWiseHistoricalData endpoint. */
export interface SecurityWiseHistoricalRow {
  CH_SYMBOL?: string;
  CH_SERIES?: string; // "EQ" | "BL" | "DL" | ... (request series=ALL returns every series)
  mTIMESTAMP?: string; // Display trade date, e.g. "05-Aug-2026"
  CH_TIMESTAMP?: string; // ISO timestamp, e.g. "2026-08-04T18:30:00.000Z"
  CH_PREVIOUS_CLS_PRICE?: number | string;
  CH_OPENING_PRICE?: number | string;
  CH_TRADE_HIGH_PRICE?: number | string;
  CH_TRADE_LOW_PRICE?: number | string;
  CH_LAST_TRADED_PRICE?: number | string;
  CH_CLOSING_PRICE?: number | string;
  VWAP?: number | string;
  CH_TOT_TRADED_QTY?: number | string;
  CH_TOT_TRADED_VAL?: number | string;
  CH_TOTAL_TRADES?: number | string;
  COP_DELIV_QTY?: number | string | null;
  COP_DELIV_PERC?: number | string | null;
  CA?: unknown[]; // Optional corporate action events attached to the row
}

/** Normalized OHLCV bar with delivery info (what backtests / charts consume). */
export interface SecurityWiseHistoricalBar {
  symbol: string;
  series: string;
  timestamp: number; // ms epoch of the trade date (start of day, local)
  date: string; // ISO date (YYYY-MM-DD)
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  vwap: number;
  volume: number;
  value: number;
  trades: number;
  deliveryQty: number | null;
  deliveryPercent: number | null;
  corporateActions?: unknown[];
}

/**
 * Fetch security-wise historical OHLCV data for a symbol from NSE.
 *
 * Endpoint:
 *   GET /api/historicalOR/generateSecurityWiseHistoricalData
 *     ?from=DD-MM-YYYY&to=DD-MM-YYYY&symbol=SYMBOL&type=priceVolumeDeliverable&series=ALL
 *
 * Response: `{ data: SecurityWiseHistoricalRow[] }` sorted newest-first.
 * `series=ALL` includes every series (EQ, BL, DL, ...) — pass `filterSeries` to
 * narrow (e.g. "EQ" for equity backtests).
 *
 * @param symbol       NSE ticker (e.g. "RELIANCE")
 * @param fromDate     Inclusive start, DD-MM-YYYY
 * @param toDate       Inclusive end, DD-MM-YYYY
 * @param filterSeries Optional series filter — only rows with this CH_SERIES are kept (default: keep all)
 */
export async function fetchSecurityWiseHistoricalData(
  symbol: string,
  fromDate: string,
  toDate: string,
  filterSeries?: string
): Promise<SecurityWiseHistoricalBar[]> {
  try {
    const qs =
      `?from=${encodeURIComponent(fromDate)}` +
      `&to=${encodeURIComponent(toDate)}` +
      `&symbol=${encodeURIComponent(symbol.toUpperCase())}` +
      `&type=priceVolumeDeliverable&series=ALL`;

    const raw = (await nseFetch(
      "/api/historicalOR/generateSecurityWiseHistoricalData",
      qs
    )) as unknown;
    const payload = raw as { data?: SecurityWiseHistoricalRow[] };
    const rows = Array.isArray(payload?.data) ? payload.data : [];

    const bars = rows
      .filter((row) => !filterSeries || row.CH_SERIES === filterSeries)
      .map((row) => rowToBar(row, symbol))
      .filter((bar): bar is SecurityWiseHistoricalBar => bar !== null);

    logger.info({
      msg: "[NSE API] Security-wise historical data fetched",
      symbol,
      fromDate,
      toDate,
      filterSeries: filterSeries ?? "ALL",
      count: bars.length,
    });
    return bars;
  } catch (error) {
    logger.error({
      msg: "[NSE API] Failed to fetch security-wise historical data",
      symbol,
      fromDate,
      toDate,
      error,
    });
    return [];
  }
}

/** Map a raw NSE row to a normalized bar; returns null for unparseable rows. */
function rowToBar(
  row: SecurityWiseHistoricalRow,
  fallbackSymbol: string
): SecurityWiseHistoricalBar | null {
  const ts = parseNseDate(row.mTIMESTAMP || row.CH_TIMESTAMP || "");
  if (!ts) return null;

  const num = (v: number | string | null | undefined): number =>
    typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  const safeNum = (v: number | string | null | undefined): number | null => {
    const n = num(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return {
    symbol: row.CH_SYMBOL || fallbackSymbol,
    series: row.CH_SERIES || "",
    timestamp: ts.getTime(),
    date: ts.toISOString().split("T")[0],
    open: num(row.CH_OPENING_PRICE),
    high: num(row.CH_TRADE_HIGH_PRICE),
    low: num(row.CH_TRADE_LOW_PRICE),
    close: num(row.CH_CLOSING_PRICE),
    previousClose: num(row.CH_PREVIOUS_CLS_PRICE),
    vwap: num(row.VWAP),
    volume: num(row.CH_TOT_TRADED_QTY),
    value: num(row.CH_TOT_TRADED_VAL),
    trades: num(row.CH_TOTAL_TRADES),
    deliveryQty: safeNum(row.COP_DELIV_QTY),
    deliveryPercent: safeNum(row.COP_DELIV_PERC),
    corporateActions: row.CA,
  };
}

/**
 * Convert normalized NSE bars to the OHLCV shape used by the backtest engine
 * and technical-analysis helpers. Bars are sorted ascending by timestamp.
 */
export function securityWiseBarsToOHLCV(
  bars: SecurityWiseHistoricalBar[]
): { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] {
  return bars
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((b) => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Build query string from options
 */
function buildQueryString(options: NseApiOptions): string {
  const params = new URLSearchParams();
  
  if (options.fromDate && options.toDate) {
    params.set('from_date', options.fromDate);
    params.set('to_date', options.toDate);
  }
  if (options.symbol) {
    params.set('symbol', options.symbol);
  }
  if (options.index) {
    params.set('index', options.index);
  }
  
  const qs = params.toString();
  return qs ? (qs.includes('from_date') ? `&${qs}` : `?${qs}`) : '';
}

// =============================================================================
// Advance/Decline APIs
// =============================================================================

/**
 * Fetch advances from NSE
 * Live: https://www.nseindia.com/api/live-analysis-advance
 */
export async function fetchAdvances(): Promise<{ data: any[]; count: number }> {
  try {
    const response = await nseFetch("/api/live-analysis-advance");
    const parsed = response as any;
    const categoryData = parsed?.advance;
    
    if (!categoryData || !Array.isArray(categoryData.data)) {
      return { data: [], count: 0 };
    }
    
    const stocks = categoryData.data
      .filter((item: any) => item.symbol && item.pchange !== undefined)
      .map((item: any) => ({
        symbol: item.symbol,
        lastPrice: Number(item.lastPrice || 0),
        pchange: Number(item.pchange || 0),
        change: Number(item.change || 0),
        previousClose: Number(item.previousClose || 0),
        identifier: "Advances" as const,
      }));
    
    const count = categoryData.count?.Advances || stocks.length;
    logger.info({ msg: '[NSE API] Fetched advances', count: stocks.length });
    return { data: stocks, count };
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch advances', error });
    return { data: [], count: 0 };
  }
}

/**
 * Fetch declines from NSE
 * Live: https://www.nseindia.com/api/live-analysis-decline
 */
export async function fetchDeclines(): Promise<{ data: any[]; count: number }> {
  try {
    const response = await nseFetch("/api/live-analysis-decline");
    const parsed = response as any;
    const categoryData = parsed?.decline;
    
    if (!categoryData || !Array.isArray(categoryData.data)) {
      return { data: [], count: 0 };
    }
    
    const stocks = categoryData.data
      .filter((item: any) => item.symbol && item.pchange !== undefined)
      .map((item: any) => ({
        symbol: item.symbol,
        lastPrice: Number(item.lastPrice || 0),
        pchange: Number(item.pchange || 0),
        change: Number(item.change || 0),
        previousClose: Number(item.previousClose || 0),
        identifier: "Declines" as const,
      }));
    
    const count = categoryData.count?.Declines || stocks.length;
    logger.info({ msg: '[NSE API] Fetched declines', count: stocks.length });
    return { data: stocks, count: count };
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch declines', error });
    return { data: [], count: 0 };
  }
}

/**
 * Fetch unchanged from NSE
 * Live: https://www.nseindia.com/api/live-analysis-unchanged
 */
export async function fetchUnchanged(): Promise<{ data: any[]; count: number }> {
  try {
    const response = await nseFetch("/api/live-analysis-unchanged");
    const parsed = response as any;
    const categoryData = parsed?.Unchange;
    
    if (!categoryData || !Array.isArray(categoryData.data)) {
      return { data: [], count: 0 };
    }
    
    const stocks = categoryData.data
      .filter((item: any) => item.symbol && item.pchange !== undefined)
      .map((item: any) => ({
        symbol: item.symbol,
        lastPrice: Number(item.lastPrice || 0),
        pchange: Number(item.pchange || 0),
        change: Number(item.change || 0),
        previousClose: Number(item.previousClose || 0),
        identifier: "Unchanged" as const,
      }));
    
    const count = categoryData.count?.Unchanged || categoryData.count?.Unchanged || stocks.length;
    logger.info({ msg: '[NSE API] Fetched unchanged', count: stocks.length });
    return { data: stocks, count };
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch unchanged', error });
    return { data: [], count: 0 };
  }
}

/**
 * Fetch all advance/decline data from NSE
 * Combines advances, declines, and unchanged
 */
export async function fetchAdvanceDecline(): Promise<AdvanceDeclineData> {
  const [advancesRes, declinesRes, unchangedRes] = await Promise.all([
    fetchAdvances(),
    fetchDeclines(),
    fetchUnchanged(),
  ]);

  const allStocks = [
    ...advancesRes.data,
    ...declinesRes.data,
    ...unchangedRes.data,
  ];

  return {
    advances: advancesRes.count,
    declines: declinesRes.count,
    unchanged: unchangedRes.count,
    total: advancesRes.count + declinesRes.count + unchangedRes.count,
    stocks: allStocks,
  };
}

// =============================================================================
// Corporate Actions API
// =============================================================================

/**
 * Fetch corporate actions from NSE
 * Live: https://www.nseindia.com/api/corporates-corporateActions?index=equities
 * Historical: https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
 */
export async function fetchCorporateActions(options?: NseApiOptions): Promise<CorporateAction[]> {
  try {
    let url = `${NSE_BASE}/api/corporates-corporateActions?index=equities`;
    
    if (options?.fromDate && options?.toDate) {
      url = `${NSE_BASE}/api/corporates-corporateActions?index=equities&from_date=${options.fromDate}&to_date=${options.toDate}`;
    }
    
    logger.info({ msg: '[NSE API] Fetching corporate actions', url: url.split('?')[1] });
    
    const data = await nseFetch(url);
    const actions = Array.isArray(data) ? data : (data?.data || []);
    
    logger.info({ msg: '[NSE API] Corporate actions fetched', count: actions.length });
    return actions;
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch corporate actions', error });
    return [];
  }
}

// =============================================================================
// Corporate Announcements API
// =============================================================================

/**
 * Fetch corporate announcements from NSE
 * Live: https://www.nseindia.com/api/corporate-announcements?index=equities
 * Historical: https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
 */
export async function fetchCorporateAnnouncements(options?: NseApiOptions): Promise<CorporateAnnouncement[]> {
  try {
    let url = `${NSE_BASE}/api/corporate-announcements?index=equities`;
    
    const params = new URLSearchParams();
    if (options?.symbol) params.set('symbol', options.symbol);
    if (options?.fromDate) params.set('from_date', options.fromDate);
    if (options?.toDate) params.set('to_date', options.toDate);
    
    if (params.toString()) {
      url += '&' + params.toString();
    }
    
    logger.info({ msg: '[NSE API] Fetching corporate announcements', symbol: options?.symbol });
    
    const data = await nseFetch(url);
    const announcements = Array.isArray(data) ? data : (data?.data || []);
    
    logger.info({ msg: '[NSE API] Corporate announcements fetched', count: announcements.length });
    return announcements;
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch corporate announcements', error });
    return [];
  }
}

// =============================================================================
// Event Calendar API
// =============================================================================

/**
 * Fetch event calendar from NSE
 * Live: https://www.nseindia.com/api/event-calendar?
 * Historical: https://www.nseindia.com/api/event-calendar?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
 */
export async function fetchEventCalendar(options?: NseApiOptions): Promise<EventCalendarItem[]> {
  try {
    let url = `${NSE_BASE}/api/event-calendar?`;
    
    if (options?.fromDate && options?.toDate) {
      url = `${NSE_BASE}/api/event-calendar?index=equities&from_date=${options.fromDate}&to_date=${options.toDate}`;
    }
    
    logger.info({ msg: '[NSE API] Fetching event calendar' });
    
    const data = await nseFetch(url);
    const events = Array.isArray(data) ? data : (data?.data || []);
    
    logger.info({ msg: '[NSE API] Event calendar fetched', count: events.length });
    return events;
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch event calendar', error });
    return [];
  }
}

// =============================================================================
// Deals APIs (Block, Bulk, Short Selling)
// =============================================================================

/**
 * Fetch large deals (block, bulk, short selling) from NSE
 * Live: https://www.nseindia.com/api/snapshot-capital-market-largedeal
 */
export async function fetchLargeDeals(): Promise<DealData[]> {
  try {
    const url = `${NSE_BASE}/api/snapshot-capital-market-largedeal`;
    
    logger.info({ msg: '[NSE API] Fetching large deals' });
    
    const data = await nseFetch(url);
    const deals = Array.isArray(data) ? data : (data?.data || []);
    
    logger.info({ msg: '[NSE API] Large deals fetched', count: deals.length });
    return deals;
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch large deals', error });
    return [];
  }
}

// =============================================================================
// Volume Analysis API
// =============================================================================

/**
 * Fetch volume analysis (stocks traded) from NSE
 * Live: https://www.nseindia.com/api/live-analysis-stocksTraded
 */
export async function fetchVolumeAnalysis(): Promise<VolumeAnalysisData[]> {
  try {
    const url = `${NSE_BASE}/api/live-analysis-stocksTraded`;
    
    logger.info({ msg: '[NSE API] Fetching volume analysis' });
    
    const data = await nseFetch(url);
    const stocks = Array.isArray(data) ? data : (data?.data || []);
    
    const transformed = stocks.map((item: any) => ({
      symbol: item.symbol || '',
      lastPrice: Number(item.lastPrice || 0),
      tradedQuantity: Number(item.quantity || item.tradedQuantity || 0),
      turnover: Number(item.turnover || 0),
     adar: item.adar ? Number(item.adar) : undefined,
    }));
    
    logger.info({ msg: '[NSE API] Volume analysis fetched', count: transformed.length });
    return transformed;
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch volume analysis', error });
    return [];
  }
}

// =============================================================================
// Insider Trading API
// =============================================================================

/**
 * Fetch insider trading data from NSE
 * Daily: https://www.nseindia.com/api/corporates-pit?
 * Historical: https://www.nseindia.com/api/corporates-pit?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
 */
export async function fetchInsiderTrading(options?: NseApiOptions): Promise<any[]> {
  try {
    let url: string;
    
    if (options?.fromDate && options?.toDate) {
      // Historical data with date range
      url = `${NSE_BASE}/api/corporates-pit?index=equities&from_date=${options.fromDate}&to_date=${options.toDate}`;
    } else {
      // Daily data - use the base endpoint
      url = `${NSE_BASE}/api/corporates-pit?`;
    }
    
    logger.info({ msg: '[NSE API] Fetching insider trading', url, fromDate: options?.fromDate, toDate: options?.toDate });
    
    const data = await nseFetch(url);
    const insiderData = Array.isArray(data) ? data : (data?.data || []);
    
    logger.info({ msg: '[NSE API] Insider trading fetched', count: insiderData.length });
    return insiderData;
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch insider trading', error });
    return [];
  }
}

// =============================================================================
// Financial Results API
// =============================================================================

/**
 * Fetch financial results for a symbol
 * API: https://www.nseindia.com/api/results-comparision?index=equities&symbol=SYMBOL
 */
export async function fetchFinancialResults(symbol: string): Promise<any> {
  try {
    const url = `${NSE_BASE}/api/results-comparision?index=equities&symbol=${encodeURIComponent(symbol)}`;
    
    logger.info({ msg: '[NSE API] Fetching financial results', symbol });
    
    const data = await nseFetch(url);
    
    logger.info({ msg: '[NSE API] Financial results fetched', symbol });
    return data;
  } catch (error) {
    logger.error({ msg: '[NSE API] Failed to fetch financial results', error, symbol });
    return null;
  }
}
