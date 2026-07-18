/**
 * Service to fetch F&O chain data from NSE India API.
 * Provides option chain for indices and stock derivatives.
 */
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";

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
  volume: number;
  impliedVolatility: number;
  totalTurnover: number;
  bidQty: number;
  bidPrice: number;
  askQty: number;
  askPrice: number;
  underlying: string;
  underlyingValue: number;
}

export interface FOExpiry {
  symbol: string;
  expiryDate: string; // ISO string
  daysToExpiry: number;
  weekly?: boolean;
}

export interface FOChainData {
  underlying: string;
  underlyingValue: number;
  timestamp: string;
  expiries: string[];
  contracts: FOContract[];
}

// ─── Constants ───────────────────────────────────────────────────────────

const NSE_FO_BASE = "https://www.nseindia.com/api/option-chain";
const FALLBACK_UNDERLYING_VALUE = 24200;

// ─── Functions ───────────────────────────────────────────────────────────

/**
 * Fetch option chain for a symbol from NSE.
 */
export async function fetchOptionChain(
  symbol: string = "NIFTY"
): Promise<FOChainData> {
  try {
    const url = `${NSE_FO_BASE}?symbol=${encodeURIComponent(symbol)}`;
    const data: any = await nseFetch(url);

    if (!data?.records?.data) {
      logger.warn({ msg: "No F&O chain data from NSE", symbol });
      return getFallbackChain(symbol);
    }

    const underlyingValue = data.records.underlyingValue || FALLBACK_UNDERLYING_VALUE;
    const expiries: string[] = data.records.expiryDates || [];
    const contracts: FOContract[] = [];

    for (const item of data.records.data) {
      if (item.CE) {
        contracts.push({
          symbol: item.CE?.identifier?.split(":")?.[1] || symbol,
          expiry: item.expiryDate || "",
          strike: item.strikePrice || 0,
          type: "CE",
          lastPrice: item.CE.lastPrice || 0,
          change: item.CE.change || 0,
          pChange: item.CE.pChange || 0,
          openInterest: item.CE.openInterest || 0,
          changeinOpenInterest: item.CE.changeinOpenInterest || 0,
          volume: item.CE.totalTradedVolume || 0,
          impliedVolatility: item.CE.impliedVolatility || 0,
          totalTurnover: item.CE.totalTurnover || 0,
          bidQty: item.CE.bidQty || 0,
          bidPrice: item.CE.bidPrice || 0,
          askQty: item.CE.askQty || 0,
          askPrice: item.CE.askPrice || 0,
          underlying: symbol,
          underlyingValue,
        });
      }
      if (item.PE) {
        contracts.push({
          symbol: item.PE?.identifier?.split(":")?.[1] || symbol,
          expiry: item.expiryDate || "",
          strike: item.strikePrice || 0,
          type: "PE",
          lastPrice: item.PE.lastPrice || 0,
          change: item.PE.change || 0,
          pChange: item.PE.pChange || 0,
          openInterest: item.PE.openInterest || 0,
          changeinOpenInterest: item.PE.changeinOpenInterest || 0,
          volume: item.PE.totalTradedVolume || 0,
          impliedVolatility: item.PE.impliedVolatility || 0,
          totalTurnover: item.PE.totalTurnover || 0,
          bidQty: item.PE.bidQty || 0,
          bidPrice: item.PE.bidPrice || 0,
          askQty: item.PE.askQty || 0,
          askPrice: item.PE.askPrice || 0,
          underlying: symbol,
          underlyingValue,
        });
      }
    }

    return {
      underlying: symbol,
      underlyingValue,
      timestamp: new Date().toISOString(),
      expiries,
      contracts,
    };
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
        weekly: daysToExpiry <= 7,
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
  };
}

/**
 * List known F&O eligible symbols.
 */
export const FO_ELIGIBLE_SYMBOLS = [
  "NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "BANKEX",
  "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
  "SBIN", "BHARTIARTL", "ITC", "WIPRO", "TITAN",
  "MARUTI", "TATAMOTORS", "BAJFINANCE", "HCLTECH", "KOTAKBANK",
  "LT", "AXISBANK", "HINDUNILVR", "SUNPHARMA", "ONGC",
  "NTPC", "POWERGRID", "M&M", "TATASTEEL", "JSWSTEEL",
  "ADANIPORTS", "ASIANPAINT", "BAJAJFINSV", "CIPLA", "DIVISLAB",
  "DRREDDY", "GRASIM", "HEROMOTOCO", "HINDALCO", "NESTLEIND",
  "SBILIFE", "ULTRACEMCO", "TECHM", "BRITANNIA", "EICHERMOT",
  "COALINDIA", "IOC", "BPCL", "GAIL", "HAL",
];
