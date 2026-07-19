/**
 * Market Cap Classification Utilities
 *
 * Classifies NSE stocks into Bluechip, NIFTY50, Large Cap, and Mid Cap
 * categories for display filtering on the recommendations page.
 *
 * Uses a curated list of well-known NIFTY50 constituents since we don't
 * fetch live market cap data in the recommendation pipeline.
 *
 * @module lib/services/marketCapClassification
 * @version 3.3.0
 */

// ─── NIFTY 50 Constituents (as of 2026) ──────────────────────────────────

/** Known NIFTY 50 stock symbols. Used for Bluechip and NIFTY50 classification. */
const NIFTY_50_SYMBOLS = new Set([
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
  "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BPCL", "BHARTIARTL",
  "BRITANNIA", "CIPLA", "COALINDIA", "DRREDDY", "EICHERMOT",
  "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE", "HEROMOTOCO",
  "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY",
  "ITC", "JSWSTEEL", "KOTAKBANK", "LTIM", "LT",
  "M&M", "MARUTI", "NESTLEIND", "NTPC", "ONGC",
  "POWERGRID", "RELIANCE", "SBILIFE", "SBIN", "SUNPHARMA",
  "TATAMOTORS", "TATASTEEL", "TCS", "TECHM", "TITAN",
  "TRENT", "ULTRACEMCO", "WIPRO", "SHRIRAMFIN", "HDFCAMC",
]);

/** Set of well-known Large Cap NSE stocks (top ~150 by market cap). */
const LARGE_CAP_SYMBOLS = new Set([
  // NIFTY 50 stocks are all large cap
  ...NIFTY_50_SYMBOLS,
  // Additional well-known large caps
  "AARTIIND", "ABB", "ABBOTINDIA", "ACC", "ALKEM",
  "AMARAJABAT", "AMBUJACEM", "BALKRISIND", "BANDHANBNK", "BATAINDIA",
  "BEL", "BERGEPAINT", "BIOCON", "BOSCHLTD", "CANBK",
  "CHAMBLFIND", "COFORGE", "CONCOR", "COROMANDEL", "CROMPTON",
  "CUMMINSIND", "DALBHARAT", "DEEPAKNTR", "DIXON", "EMAMILTD",
  "GLENMARK", "GODREJCP", "GODREJPROP", "GSPL", "HONAUT",
  "IDFCFIRSTB", "IEX", "INDHOTEL", "IOB", "JUBLFOOD",
  "LALPATHLAB", "LICHSGFIN", "LUPIN", "MARICO", "MFSL",
  "MOTHERSON", "MPHASIS", "MUTHOOTFIN", "NAM-INDIA", "OBEROIRLTY",
  "PFIZER", "PIDILITIND", "PIIND", "PVRINOX", "RAJESHEXPO",
  "RAMCOCEM", "RBLBANK", "RECLTD", "SAIL", "SOLARINDS",
  "SRF", "STARHEALTH", "SUNDARMFIN", "TATACHEM", "TATACOMM",
  "TATAELXSI", "TATAPOWER", "THERMAX", "UBL", "UNITDSPR",
  "UPL", "VEDL", "VOLTAS", "ZEEL", "ZYDUSLIFE",
  "CANFINHOME", "FEDERALBNK", "HAPPSTMNDS", "KANSAINER", "OLECTRA",
  "PERSISTENT", "POLYCAB", "TIINDIA", "TATVA", "CDSL",
  "CAMS", "KPITTECH", "Mphasis", "LTTS", "route",
]);

/** Well-known Mid Cap NSE stocks. */
const MID_CAP_SYMBOLS = new Set([
  "AFFLE", "ANGELONE", "ASTRAL", "AUROPHARMA", "BHEL",
  "CAMPUS", "CARBORUNIV", "CLEAN", "CRED", "CYIENT",
  "DELHIVERY", "DIXON", "EASEMYTRIP", "FINOLEX", "GALAXYSURF",
  "GMRP&INFRA", "GOAIR", "GPPL", "GSFC", "HAL",
  "IIFL", "INDIAMART", "IRCTC", "JSL", "LXCHEM",
  "MAHABANK", "MANAPPURAM", "MAXHEALTH", "MCDOWELL-N", "METROPOLIS",
  "MSTCLTD", "NAM-INDIA", "NATCOPHARM", "NCC", "NETWORK18",
  "NEWGEN", "NH", "PVRINOX", "RAILTEL", "RATNAMANI",
  "REDINGTON", "SAPPHIRE", "SONACOMS", "SPANDANA", "TORNTPHARM",
  "TRIDENT", "VGUARD", "VMART", "WHIRLPOOL",
]);

// ─── Classification Types ────────────────────────────────────────────────

export type StockCategory = "nifty50" | "bluechip" | "large_cap" | "mid_cap" | "other";

export interface ClassifiedStock {
  symbol: string;
  category: StockCategory;
}

// ─── Classification Functions ────────────────────────────────────────────

/**
 * Classify a single stock symbol into a market cap category.
 *
 * Priority order:
 * 1. NIFTY50 — member of NIFTY 50 index
 * 2. Bluechip — well-known large cap (in LARGE_CAP list)
 * 3. Large Cap — other large cap stocks
 * 4. Mid Cap — mid cap stocks
 * 5. Other — everything else (small cap, micro cap, unknown)
 */
export function classifyStock(symbol: string): StockCategory {
  const upper = symbol.toUpperCase();
  if (NIFTY_50_SYMBOLS.has(upper)) return "nifty50";
  if (LARGE_CAP_SYMBOLS.has(upper)) return "bluechip";
  // Heuristic: if not in known lists, classify by price/volume context
  // We return "other" and let the UI decide based on available data
  return "other";
}

/**
 * Classify a batch of stocks.
 */
export function classifyStocks(symbols: string[]): ClassifiedStock[] {
  return symbols.map((s) => ({
    symbol: s.toUpperCase(),
    category: classifyStock(s),
  }));
}

/**
 * Check if a symbol is a NIFTY50 stock.
 */
export function isNifty50(symbol: string): boolean {
  return NIFTY_50_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Check if a symbol is a bluechip / large cap stock.
 */
export function isBluechip(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return NIFTY_50_SYMBOLS.has(upper) || LARGE_CAP_SYMBOLS.has(upper);
}

/**
 * Check if a symbol is a large cap stock.
 */
export function isLargeCap(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return NIFTY_50_SYMBOLS.has(upper) || LARGE_CAP_SYMBOLS.has(upper);
}

/**
 * Check if a symbol is a mid cap stock.
 */
export function isMidCap(symbol: string): boolean {
  return MID_CAP_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Get the display label and color for a stock category.
 */
export function getCategoryMeta(category: StockCategory): {
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  sortPriority: number;
} {
  switch (category) {
    case "nifty50":
      return {
        label: "NIFTY 50",
        bgColor: "bg-yellow-500/15",
        textColor: "text-yellow-400",
        borderColor: "border-yellow-500/30",
        sortPriority: 1,
      };
    case "bluechip":
      return {
        label: "Bluechip",
        bgColor: "bg-blue-500/15",
        textColor: "text-blue-400",
        borderColor: "border-blue-500/30",
        sortPriority: 2,
      };
    case "large_cap":
      return {
        label: "Large Cap",
        bgColor: "bg-purple-500/15",
        textColor: "text-purple-400",
        borderColor: "border-purple-500/30",
        sortPriority: 3,
      };
    case "mid_cap":
      return {
        label: "Mid Cap",
        bgColor: "bg-teal-500/15",
        textColor: "text-teal-400",
        borderColor: "border-teal-500/30",
        sortPriority: 4,
      };
    default:
      return {
        label: "Other",
        bgColor: "bg-gray-500/15",
        textColor: "text-gray-400",
        borderColor: "border-gray-500/30",
        sortPriority: 5,
      };
  }
}

/**
 * Sort comparator that orders stocks by category priority.
 * NIFTY50 → Bluechip → Large Cap → Mid Cap → Other.
 */
export function categorySortPriority(a: string, b: string): number {
  const catA = getCategoryMeta(classifyStock(a));
  const catB = getCategoryMeta(classifyStock(b));
  return catA.sortPriority - catB.sortPriority;
}
