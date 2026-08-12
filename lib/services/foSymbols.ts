/**
 * Pure zero-import module: known F&O eligible symbols.
 *
 * Client-safe — no imports, so it can be value-imported from Client Components
 * without dragging the prisma/pg chain into the browser bundle.
 * Server callers re-export from `lib/services/nse-fo-api.ts`.
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
] as const;
