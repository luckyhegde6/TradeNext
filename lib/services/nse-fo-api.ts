/**
 * Service to fetch F&O chain data from NSE India API.
 * Provides option chain for indices and stock derivatives.
 *
 * Uses the option-chain-v3 endpoint:
 *   https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry=18-Aug-2026
 *
 * v3 contract notes (vs the legacy /api/option-chain):
 * - `type` param: `Indices` for index derivatives, `Stocks` for stock derivatives
 * - optional `expiry` param in DD-MMM-YYYY (e.g. 18-Aug-2026) — server-side expiry filter
 * - bid/ask renamed: buyPrice1/buyQuantity1 (bid) + sellPrice1/sellQuantity1 (ask)
 * - new fields: pchangeinOpenInterest, totalBuyQuantity, totalSellQuantity
 * - unquoted strikes carry empty `{}` CE/PE objects — must be skipped
 * - `records.filtered` holds per-side totals: CE/PE { totOI, totVol }
 * - dates: expiryDates "18-Aug-2026", CE.expiryDate "18-08-2026", timestamp "12-Aug-2026 15:40:00"
 */
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { FO_ELIGIBLE_SYMBOLS } from "./foSymbols";

// ─── Types ───────────────────────────────────────────────────────────────

export interface FOContract {
  symbol: string;
  expiry: string; // ISO date string
  strike: number;
  type: "CE" | "PE";
  lastPrice: number;
  change: number;
  pChange: number;
  openInterest: number;
  changeinOpenInterest: number;
  pchangeinOpenInterest: number;
  volume: number;
  impliedVolatility: number;
  totalTurnover: number;
  bidQty: number;
  bidPrice: number;
  askQty: number;
  askPrice: number;
  totalBuyQuantity: number;
  totalSellQuantity: number;
  underlying: string;
  underlyingValue: number;
}

export interface FOExpiry {
  symbol: string;
  expiryDate: string; // ISO string
  daysToExpiry: number;
  weekly?: boolean;
}

/** Per-side totals from records.filtered (CE/PE total OI + total volume). */
export interface FOSideTotals {
  totOI: number;
  totVol: number;
}

export interface FOFilteredTotals {
  CE: FOSideTotals;
  PE: FOSideTotals;
}

export interface FOChainData {
  underlying: string;
  underlyingValue: number;
  timestamp: string;
  expiries: string[];
  contracts: FOContract[];
  filtered: FOFilteredTotals;
  strikePrices: number[];
}

// ─── Constants ───────────────────────────────────────────────────────────

const NSE_FO_BASE = "https://www.nseindia.com/api/option-chain-v3";
const FALLBACK_UNDERLYING_VALUE = 24200;

/** Index symbols have `type=Indices` (weekly expiries); everything else is a stock. */
const FO_INDEX_SYMBOLS: ReadonlySet<string> = new Set([
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "SENSEX",
  "BANKEX",
]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

// ─── Date helpers (pure, exported for tests) ─────────────────────────────

/**
 * Parse an NSE expiry date string into an ISO date (YYYY-MM-DD).
 * Handles both "18-Aug-2026" (expiryDates) and "18-08-2026" (CE.expiryDate).
 * Returns the input unchanged if it is already an ISO date or unparseable.
 */
export function parseNseExpiryDate(value: string): string {
  if (!value) return value;
  // Already ISO-ish (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const parts = value.split("-");
  if (parts.length !== 3) return value;
  const [day, month, year] = parts;
  if (!/^\d{2}$/.test(day) || !/^\d{4}$/.test(year)) return value;

  let monthNum = Number(month);
  if (Number.isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    const idx = MONTHS.indexOf(month as (typeof MONTHS)[number]);
    if (idx === -1) return value;
    monthNum = idx + 1;
  }
  return `${year}-${String(monthNum).padStart(2, "0")}-${day}`;
}

/**
 * Parse an NSE timestamp "12-Aug-2026 15:40:00" into an ISO string.
 * Falls back to the raw value when unparseable.
 */
export function parseNseTimestamp(value: string): string {
  if (!value) return value;
  const match = value.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return value;
  const [, day, monthStr, year, hour, minute, second] = match;
  const monthIdx = MONTHS.indexOf(monthStr as (typeof MONTHS)[number]);
  if (monthIdx === -1) return value;
  // Build a UTC date to avoid local-tz drift; caller displays with toLocale*.
  return new Date(
    Date.UTC(Number(year), monthIdx, Number(day), Number(hour), Number(minute), Number(second))
  ).toISOString();
}

/**
 * Convert an ISO date (YYYY-MM-DD) to the NSE expiry param format DD-MMM-YYYY.
 * e.g. "2026-08-18" → "18-Aug-2026". Passthrough when already in that shape.
 */
export function toNseExpiryParam(value: string): string {
  if (!value) return value;
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(value)) return value;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthIdx = Number(month) - 1;
  if (monthIdx < 0 || monthIdx > 11) return value;
  return `${day}-${MONTHS[monthIdx]}-${year}`;
}

/** True when the symbol trades index derivatives (type=Indices on NSE). */
export function isIndexSymbol(symbol: string): boolean {
  return FO_INDEX_SYMBOLS.has(symbol.toUpperCase());
}

// ─── Pure v3 response parser ─────────────────────────────────────────────

/**
 * Map a raw option-chain-v3 response into FOChainData.
 * Pure + exported for unit tests; handles the v3 contract (empty {} sides,
 * renamed bid/ask fields, per-side filtered totals, NSE date formats).
 */
export function parseOptionChainV3(raw: unknown, symbol: string): FOChainData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = raw as any;
  const records = data?.records ?? {};
  const underlyingValue =
    Number(records.underlyingValue) || FALLBACK_UNDERLYING_VALUE;

  const expiries: string[] = Array.isArray(records.expiryDates)
    ? records.expiryDates.map((d: string) => parseNseExpiryDate(d)).filter(Boolean)
    : [];

  const strikePrices: number[] = Array.isArray(records.strikePrices)
    ? records.strikePrices.map(Number).filter((n: number) => !Number.isNaN(n))
    : [];

  const contracts: FOContract[] = [];
  const rows: unknown[] = Array.isArray(records.data) ? records.data : [];

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = row as any;
    const strike = Number(item?.strikePrice) || 0;
    // Row-level expiry (expiryDates) may differ from the per-side expiryDate in v3.
    const rowExpiry = parseNseExpiryDate(String(item?.expiryDates ?? ""));

    for (const type of ["CE", "PE"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const side = item?.[type] as any;
      // v3 returns empty {} objects for unquoted strikes — skip them.
      if (!side || typeof side !== "object" || Object.keys(side).length === 0) continue;

      const expiry = parseNseExpiryDate(String(side.expiryDate ?? "")) || rowExpiry;
      contracts.push({
        symbol: String(side.underlying ?? symbol) || symbol,
        expiry,
        strike,
        type,
        lastPrice: Number(side.lastPrice) || 0,
        change: Number(side.change) || 0,
        pChange: Number(side.pChange) || 0,
        openInterest: Number(side.openInterest) || 0,
        changeinOpenInterest: Number(side.changeinOpenInterest) || 0,
        pchangeinOpenInterest: Number(side.pchangeinOpenInterest) || 0,
        volume: Number(side.totalTradedVolume) || 0,
        impliedVolatility: Number(side.impliedVolatility) || 0,
        totalTurnover: Number(side.totalTurnover) || 0,
        bidQty: Number(side.buyQuantity1) || 0,
        bidPrice: Number(side.buyPrice1) || 0,
        askQty: Number(side.sellQuantity1) || 0,
        askPrice: Number(side.sellPrice1) || 0,
        totalBuyQuantity: Number(side.totalBuyQuantity) || 0,
        totalSellQuantity: Number(side.totalSellQuantity) || 0,
        underlying: symbol,
        underlyingValue,
      });
    }
  }

  // Per-side totals from the top-level `filtered` block (CE/PE total OI + total volume).
  const filtered = data?.filtered ?? {};
  const totals: FOFilteredTotals = {
    CE: {
      totOI: Number(filtered.CE?.totOI) || 0,
      totVol: Number(filtered.CE?.totVol) || 0,
    },
    PE: {
      totOI: Number(filtered.PE?.totOI) || 0,
      totVol: Number(filtered.PE?.totVol) || 0,
    },
  };

  const timestamp = records.timestamp
    ? parseNseTimestamp(String(records.timestamp))
    : new Date().toISOString();

  return { underlying: symbol, underlyingValue, timestamp, expiries, contracts, filtered: totals, strikePrices };
}

// ─── Functions ───────────────────────────────────────────────────────────

/**
 * Fetch option chain for a symbol from NSE (option-chain-v3).
 * Optional `expiry` (ISO date, e.g. "2026-08-18") filters server-side.
 */
export async function fetchOptionChain(
  symbol: string = "NIFTY",
  expiry?: string
): Promise<FOChainData> {
  try {
    const type = isIndexSymbol(symbol) ? "Indices" : "Stocks";
    let url = `${NSE_FO_BASE}?type=${type}&symbol=${encodeURIComponent(symbol)}`;
    if (expiry) {
      url += `&expiry=${encodeURIComponent(toNseExpiryParam(expiry))}`;
    }
    const raw = await nseFetch(url);

    if (!raw || typeof raw !== "object") {
      logger.warn({ msg: "No F&O chain data from NSE", symbol });
      return getFallbackChain(symbol);
    }

    const chain = parseOptionChainV3(raw, symbol);
    if (chain.contracts.length === 0 && !expiry) {
      logger.warn({ msg: "Empty F&O chain from NSE", symbol });
      return getFallbackChain(symbol);
    }
    return chain;
  } catch (err) {
    logger.error({ msg: "Failed to fetch NSE option chain", symbol, error: err });
    return getFallbackChain(symbol);
  }
}

/**
 * Get available expiry dates.
 */
export async function fetchExpiries(symbol: string = "NIFTY"): Promise<FOExpiry[]> {
  try {
    const chain = await fetchOptionChain(symbol);
    const now = new Date();

    return chain.expiries.map((dateStr) => {
      const expiryDate = new Date(dateStr);
      const daysToExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        symbol,
        expiryDate: expiryDate.toISOString(),
        daysToExpiry: Math.max(0, daysToExpiry),
        // Index derivatives trade a weekly series (~next 5 Thursdays); stocks are monthly only.
        weekly: isIndexSymbol(symbol) ? daysToExpiry <= 35 : false,
      };
    });
  } catch (err) {
    logger.error({ msg: "Failed to fetch expiries", symbol, error: err });
    return [];
  }
}

// ─── Fallback ────────────────────────────────────────────────────────────

function getFallbackChain(symbol: string): FOChainData {
  return {
    underlying: symbol,
    underlyingValue: FALLBACK_UNDERLYING_VALUE,
    timestamp: new Date().toISOString(),
    expiries: [],
    contracts: [],
    filtered: { CE: { totOI: 0, totVol: 0 }, PE: { totOI: 0, totVol: 0 } },
    strikePrices: [],
  };
}

/**
 * List known F&O eligible symbols (pure module — client-safe).
 * Re-exported for server callers.
 */
export { FO_ELIGIBLE_SYMBOLS };
