/**
 * F&O P&L and Option Greeks computation.
 *
 * Greeks computed using Black-Scholes analytical formulas.
 * For educational/fast-estimation purposes — not trading-grade.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface OptionGreeks {
  delta: number;
  gamma: number;
  theta: number; // per day
  vega: number; // per 1% IV change
  rho: number;
}

export interface FOPnLResult {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positions: {
    id: string;
    symbol: string;
    type: string;
    direction: string;
    entryPrice: number;
    currentPrice: number | null;
    quantity: number;
    pnl: number;
    greeks?: OptionGreeks;
  }[];
}

// ─── Statistical helpers ────────────────────────────────────────────────

function cumulativeNormal(x: number): number {
  // Abramowitz and Stegun approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

function normalDensity(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ─── Black-Scholes Greeks ────────────────────────────────────────────────

/**
 * Compute option Greeks using Black-Scholes.
 *
 * @param type "CALL" | "PUT"
 * @param S Underlying price
 * @param K Strike price
 * @param T Time to expiry in years
 * @param r Risk-free rate (e.g., 0.07 for 7%)
 * @param sigma Implied volatility (e.g., 0.20 for 20%)
 */
export function computeGreeks(
  type: "CALL" | "PUT",
  S: number,
  K: number,
  T: number,
  r: number = 0.07,
  sigma: number = 0.20
): OptionGreeks {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const isCall = type === "CALL";
  const phi = isCall ? 1 : -1;

  const delta = phi * cumulativeNormal(phi * d1);
  const gamma = normalDensity(d1) / (S * sigma * Math.sqrt(T));
  const vega = S * normalDensity(d1) * Math.sqrt(T) / 100; // per 1% IV change
  const theta = isCall
    ? -(S * normalDensity(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * cumulativeNormal(d2)
    : -(S * normalDensity(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * cumulativeNormal(-d2);
  const thetaPerDay = theta / 365;
  const rho = isCall
    ? K * T * Math.exp(-r * T) * cumulativeNormal(d2) / 100
    : -K * T * Math.exp(-r * T) * cumulativeNormal(-d2) / 100;

  return {
    delta: Math.round(delta * 1000) / 1000,
    gamma: Math.round(gamma * 10000) / 10000,
    theta: Math.round(thetaPerDay * 100) / 100,
    vega: Math.round(vega * 100) / 100,
    rho: Math.round(rho * 100) / 100,
  };
}

/**
 * Estimate time to expiry in years from an expiry date.
 */
export function timeToExpiry(expiry: string | Date | null): number {
  if (!expiry) return 0;
  const expiryDate = typeof expiry === "string" ? new Date(expiry) : expiry;
  const now = new Date();
  const ms = expiryDate.getTime() - now.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  return Math.max(0, days / 365);
}

/**
 * Compute P&L for F&O positions.
 */
export interface FOComputedPosition {
  id: string;
  symbol: string;
  type: string;
  direction: string;
  entryPrice: number;
  currentPrice: number | null;
  quantity: number;
  strike: number | null;
  expiry: string | null;
  status: string;
  pnl: number;
  greeks?: OptionGreeks;
}

export function computePnL(
  positions: {
    id: string;
    symbol: string;
    type: string;
    direction: string;
    entryPrice: number;
    currentPrice: number | null;
    closePrice: number | null;
    quantity: number;
    strike: number | null;
    expiry: string | null;
    status: string;
  }[],
  underlyingPrice?: number
): FOComputedPosition[] {
  return positions.map((pos) => {
    const currentPrice = pos.closePrice ?? pos.currentPrice ?? pos.entryPrice;
    const diff = currentPrice - pos.entryPrice;
    let pnl = diff * pos.quantity;
    if (pos.direction === "SHORT") pnl = -pnl;

    const result: FOComputedPosition = {
      id: pos.id,
      symbol: pos.symbol,
      type: pos.type,
      direction: pos.direction,
      entryPrice: pos.entryPrice,
      currentPrice: pos.currentPrice,
      quantity: pos.quantity,
      strike: pos.strike,
      expiry: pos.expiry,
      status: pos.status,
      pnl: Math.round(pnl * 100) / 100,
    };

    // Compute Greeks for options
    if ((pos.type === "CALL" || pos.type === "PUT") && pos.strike && underlyingPrice) {
      const T = timeToExpiry(pos.expiry);
      if (T > 0) {
        result.greeks = computeGreeks(
          pos.type as "CALL" | "PUT",
          underlyingPrice,
          pos.strike,
          T
        );
      }
    }

    return result;
  });
}
