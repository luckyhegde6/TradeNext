/**
 * lib/services/recommendationLevelEvaluator.ts
 *
 * Direction-aware evaluation & correction of AI-generated target/stop-loss levels.
 *
 * WHY: the AI agent sometimes emits levels that contradict the recommendation
 * direction — e.g. a SELL whose targetPrice (₹306.9) sits ABOVE the current
 * price (₹279) and stopLoss (₹265.05) sits BELOW it (a BUY-style layout applied
 * to a SELL). The legacy fallback multipliers were also direction-blind
 * (target = price * 1.1, stop = price * 0.95 regardless of BUY/SELL).
 *
 * WHAT: every recommendation whose levels are produced outside this evaluator
 * must be run through it. It validates the invariant for each direction and
 * corrects (with a logged reason) when the AI levels are missing, zero,
 * contradictory, or out of bounds:
 *
 *   BUY : price * (1 - maxStopLossPct)  <  price  <  price * (1 + minTargetPct)
 *   SELL: price * (1 + minTargetPct)    >  price  >  price * (1 - maxStopLossPct)
 *   HOLD: target ≈ price * (1 + holdTargetPct), stop ≈ price * (1 - holdStopPct)
 *
 * DIRECTION TABLE (default percentages):
 *   BUY : target = price * 1.10, stopLoss = price * 0.95
 *   SELL: target = price * 0.90, stopLoss = price * 1.05   <- inverted vs legacy
 *   HOLD: target = price * 1.05, stopLoss = price * 0.95   <- tight band
 *
 * The evaluator is a PURE function (no I/O) so it is trivially testable and
 * safe to run on every path that materializes a recommendation: the agent's
 * normalizeRecommendation, the service fallback, and the backfill script.
 */

export type RecommendationDirection = "BUY" | "HOLD" | "SELL";

export interface LevelEvaluation {
  /** The direction the levels were evaluated against. */
  direction: RecommendationDirection;
  /** Corrected target price (INR). */
  targetPrice: number;
  /** Corrected stop-loss (INR). */
  stopLoss: number;
  /** True when the input levels already satisfied the direction invariant. */
  valid: boolean;
  /** Human-readable reasons describing everything that was corrected. */
  corrections: string[];
}

export interface LevelEvaluationInput {
  direction: RecommendationDirection;
  /** Current market price (INR) — the anchor for fallbacks. */
  price: number;
  /** Raw AI-provided target (INR). 0 means "not determinable" per prompt. */
  targetPrice?: number | null;
  /** Raw AI-provided stop loss (INR). 0 means "not determinable". */
  stopLoss?: number | null;
}

/** Default proportional targets/stops per direction (percent of price). */
export const DIRECTION_DEFAULTS: Record<
  RecommendationDirection,
  { targetPct: number; stopLossPct: number }
> = {
  BUY: { targetPct: 0.1, stopLossPct: 0.05 },
  SELL: { targetPct: 0.1, stopLossPct: 0.05 },
  HOLD: { targetPct: 0.05, stopLossPct: 0.05 },
};

/**
 * Reject absurd AI levels (>3x or <0.3x the current price) — a model glitch
 * producing a target of 10x the price is more harmful than a default.
 */
const MAX_LEVEL_MULTIPLIER = 3;
const MIN_LEVEL_MULTIPLIER = 0.3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when `value` is a usable positive number (not 0/NaN/null). */
function isUsable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function inBounds(value: number, price: number): boolean {
  return (
    value >= price * MIN_LEVEL_MULTIPLIER && value <= price * MAX_LEVEL_MULTIPLIER
  );
}

/**
 * Evaluate and correct target/stop-loss levels for a recommendation direction.
 *
 * Rules per direction:
 *  - BUY : target must be above price, stop loss below price (target > price > stop).
 *  - SELL : target must be below price, stop loss above price (stop > price > target).
 *  - HOLD : target slightly above price, stop slightly below price (both within band).
 *
 * When the AI levels are missing/zero/contradictory/out-of-bounds they are
 * replaced with the direction default; the correction is returned in `corrections`
 * so callers can log it (e.g. "SELL level contradicted direction, replaced").
 */
export function evaluateRecommendationLevels(
  input: LevelEvaluationInput
): LevelEvaluation {
  const { direction, price } = input;
  const rawTarget = isUsable(input.targetPrice) ? input.targetPrice! : 0;
  const rawStop = isUsable(input.stopLoss) ? input.stopLoss! : 0;
  const corrections: string[] = [];

  if (!Number.isFinite(price) || price <= 0) {
    // No anchor — nothing to evaluate against. Return raw values (may be 0).
    return {
      direction,
      targetPrice: round2(rawTarget),
      stopLoss: round2(rawStop),
      valid: false,
      corrections: ["No valid price anchor — levels left unvalidated"],
    };
  }

  const { targetPct, stopLossPct } = DIRECTION_DEFAULTS[direction];
  // Direction-aware defaults: BUY/HOLD aim up (target above, stop below);
  // SELL aims down (target below, stop above).
  const directionSign = direction === "SELL" ? -1 : 1;
  const defaultTarget = round2(price * (1 + directionSign * targetPct));
  const defaultStop = round2(price * (1 - directionSign * stopLossPct));

  // Validate raw levels against the direction invariant.
  let valid = true;
  let target = rawTarget;
  let stop = rawStop;

  const violatesInvariant = (t: number, s: number): boolean => {
    switch (direction) {
      case "BUY":
        return !(t > price && s < price && s < t);
      case "SELL":
        return !(t < price && s > price && s > t);
      case "HOLD":
        // HOLD levels are a tight band: stop < price < target, close to price.
        return !(t > price && s < price && s < t);
    }
  };

  if (!isUsable(target) || !isUsable(stop)) {
    valid = false;
    if (!isUsable(target)) {
      target = defaultTarget;
      corrections.push(`Target ${rawTarget || "missing/0"} → default ${defaultTarget}`);
    }
    if (!isUsable(stop)) {
      stop = defaultStop;
      corrections.push(`Stop-loss ${rawStop || "missing/0"} → default ${defaultStop}`);
    }
  } else if (violatesInvariant(target, stop)) {
    valid = false;
    corrections.push(
      `Levels ${target}/${stop} contradict ${direction} direction — replaced with defaults`
    );
    target = defaultTarget;
    stop = defaultStop;
  } else if (!inBounds(target, price) || !inBounds(stop, price)) {
    valid = false;
    corrections.push(`Levels ${target}/${stop} out of bounds — replaced with defaults`);
    target = defaultTarget;
    stop = defaultStop;
  }

  return { direction, targetPrice: round2(target), stopLoss: round2(stop), valid, corrections };
}