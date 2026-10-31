/**
 * lib/services/ai/fallbackAnalysis.ts
 *
 * Technical-analysis fallback target/SL calculation — used when AI credits
 * are exhausted (OpenRouter free-models-per-day 429) or the provider is
 * otherwise unavailable.
 *
 * Instead of blank OBSERVE/HOLD defaults with a 3% band, derive directional
 * levels from the stock's own momentum/indicator data so the Swing tab and
 * Daily Recommendations still show actionable picks and the performance
 * check can evaluate target/SL hits against real levels.
 *
 * Design:
 *   - Direction inferred from changePercent + momentum indicators
 *   - Target/stop sized by volatility (volatility20), clamped to sane bands
 *   - Distance-from-20d-high adjusts confidence (pullback = more conservative)
 *   - Levels run through evaluateRecommendationLevels for direction-aware
 *     validation (BUY: target>price>stop; SELL: stop>price>target)
 *   - Confidence capped at 65 so real AI verdicts (70-100) always rank higher
 *
 * PURE — zero I/O, trivially testable.
 */

import type { SwingAction, SwingAnalysis, SwingTimeHorizon } from "@/lib/services/swing-types";
import type { AIRecommendation } from "@/lib/services/ai/recommendation-agent";
import type { StockAnalysisInput } from "@/lib/services/ai/recommendation-agent";
import type { SwingAnalysisInput } from "@/lib/services/ai/swing-agent";
import { evaluateRecommendationLevels, type RecommendationDirection } from "@/lib/services/recommendationLevelEvaluator";

/** Max confidence the fallback may assign — real AI verdicts always outrank it. */
export const FALLBACK_MAX_CONFIDENCE = 65;
/** Min confidence for a directional fallback (vs pure OBSERVE/HOLD). */
export const FALLBACK_MIN_CONFIDENCE = 40;

/** Round to 2dp. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Clamp a value into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Volatility-adjusted target/stop percentages. Higher volatility → wider levels. */
function volatilityLevels(volatility20: number | null): { targetPct: number; stopPct: number } {
  const vol = clamp(volatility20 ?? 5, 2, 25); // clamp 2%–25%
  // Target ≈ 1.5× volatility, band 5%–15%
  const targetPct = clamp(vol * 0.015, 0.05, 0.15);
  // Stop ≈ 1× volatility, band 3%–8%
  const stopPct = clamp(vol * 0.01, 0.03, 0.08);
  return { targetPct, stopPct };
}

/**
 * Infer a directional action from price change + momentum indicators.
 *
 * Strong momentum in the direction of today's move → directional setup.
 * Weak/conflicting momentum → OBSERVE (no edge).
 */
function inferSwingDirection(input: {
  changePercent: number;
  momentum20: number | null;
}): { action: SwingAction; confidence: number } {
  const { changePercent, momentum20 } = input;
  const mom20 = momentum20 ?? 0;

  // Strong positive momentum → LONG
  if (changePercent > 1.5 && mom20 > 5) {
    return {
      action: "LONG",
      confidence: clamp(FALLBACK_MIN_CONFIDENCE + Math.min(mom20, 25), FALLBACK_MIN_CONFIDENCE, FALLBACK_MAX_CONFIDENCE),
    };
  }
  // Strong negative momentum → SHORT
  if (changePercent < -1.5 && mom20 < -5) {
    return {
      action: "SHORT",
      confidence: clamp(FALLBACK_MIN_CONFIDENCE + Math.min(Math.abs(mom20), 25), FALLBACK_MIN_CONFIDENCE, FALLBACK_MAX_CONFIDENCE),
    };
  }
  // Mild momentum — no clear edge
  return { action: "OBSERVE", confidence: FALLBACK_MIN_CONFIDENCE };
}

/**
 * Map a SwingAction to the tracker recommendation vocabulary (BUY/SELL/HOLD).
 */
function swingActionToDirection(action: SwingAction): RecommendationDirection {
  if (action === "LONG") return "BUY";
  if (action === "SHORT") return "SELL";
  return "HOLD";
}

/**
 * Calculate a technical-analysis fallback SwingAnalysis for one stock when AI
 * is unavailable. Returns actionable directional levels (not OBSERVE-only) so
 * the Swing tab shows targets and the performance check can evaluate them.
 *
 * Confidence is capped at 65 so real AI verdicts always outrank fallback picks.
 */
export function calculateFallbackSwingAnalysis(input: SwingAnalysisInput): SwingAnalysis {
  const { price, changePercent, momentum10, momentum20, volatility20, distanceFrom20dHigh, families } =
    input;

  const { action, confidence: dirConfidence } = inferSwingDirection({
    changePercent,
    momentum20,
  });

  const { targetPct, stopPct } = volatilityLevels(volatility20);

  // Pullback context (far from 20d high) → more conservative confidence.
  let confidence = dirConfidence;
  if (distanceFrom20dHigh != null && distanceFrom20dHigh > 10) {
    confidence = Math.max(confidence - 10, FALLBACK_MIN_CONFIDENCE);
  }
  confidence = clamp(confidence, FALLBACK_MIN_CONFIDENCE, FALLBACK_MAX_CONFIDENCE);

  const direction = swingActionToDirection(action);
  const entryPrice = round2(price);
  const { targetPrice, stopLoss } = evaluateRecommendationLevels({
    direction,
    price: entryPrice,
    targetPrice: price * (1 + (direction === "SELL" ? -targetPct : targetPct)),
    stopLoss: price * (1 - (direction === "SELL" ? -stopPct : stopPct)),
  });

  const timeHorizon: SwingTimeHorizon =
    Math.abs(changePercent) > 3 ? "short" : distanceFrom20dHigh != null && distanceFrom20dHigh > 5 ? "long" : "medium";

  const familyLabel = families.length > 0 ? families.join(", ") : "trend";
  const logic =
    `Technical fallback (AI unavailable): ${familyLabel} family setup. ` +
    `Momentum 20d ${(momentum20 ?? 0).toFixed(1)}%, 10d ${(momentum10 ?? 0).toFixed(1)}%, ` +
    `volatility ${(volatility20 ?? 0).toFixed(1)}%. Volatility-sized target ${(targetPct * 100).toFixed(0)}% / ` +
    `stop ${(stopPct * 100).toFixed(0)}%.`;

  const riskFactors: string[] = [
    "AI analysis unavailable — technical fallback levels",
    "Market volatility",
  ];
  if (distanceFrom20dHigh != null && distanceFrom20dHigh > 10) {
    riskFactors.push("Extended pullback from 20d high");
  }

  return {
    action,
    confidence,
    entryPrice,
    targetPrice: round2(targetPrice),
    stopLoss: round2(stopLoss),
    timeHorizon,
    logic,
    momentumScore: confidence,
    riskFactors,
  };
}

/**
 * Calculate a technical-analysis fallback AIRecommendation for one stock when
 * AI is unavailable. Returns actionable directional levels so Daily
 * Recommendations still show picks with targets and the performance check
 * can evaluate them.
 *
 * Confidence is capped at 65 so real AI verdicts always outrank fallback picks.
 */
export function calculateFallbackRecommendation(input: StockAnalysisInput): AIRecommendation {
  const { price, changePercent, momentum20, volatility20, screenerNames } = input;

  // Map swing-style direction to BUY/HOLD/SELL for the daily tracker vocabulary.
  const { action, confidence: dirConfidence } = inferSwingDirection({
    changePercent,
    momentum20: momentum20 ?? null,
  });

  const direction: RecommendationDirection =
    action === "LONG" ? "BUY" : action === "SHORT" ? "SELL" : "HOLD";

  const { targetPct, stopPct } = volatilityLevels(volatility20 ?? null);

  // Pullback context → more conservative confidence.
  let confidence = dirConfidence;
  confidence = clamp(confidence, FALLBACK_MIN_CONFIDENCE, FALLBACK_MAX_CONFIDENCE);

  const entryPrice = round2(price);
  const { targetPrice, stopLoss } = evaluateRecommendationLevels({
    direction,
    price: entryPrice,
    targetPrice: price * (1 + (direction === "SELL" ? -targetPct : targetPct)),
    stopLoss: price * (1 - (direction === "SELL" ? -stopPct : stopPct)),
  });

  const timeHorizon: "short" | "medium" | "long" =
    Math.abs(changePercent) > 3 ? "short" : "medium";

  const familyLabel = screenerNames.length > 0 ? screenerNames.join(", ") : "screeners";
  const reasoning =
    `Technical fallback (AI unavailable): ${flaggedBy(familyLabel)}. ` +
    `Momentum 20d ${(momentum20 ?? 0).toFixed(1)}%, volatility ${(volatility20 ?? 0).toFixed(1)}%. ` +
    `Volatility-sized target ${(targetPct * 100).toFixed(0)}% / stop ${(stopPct * 100).toFixed(0)}%.`;

  return {
    recommendation: direction,
    confidence,
    targetPrice: round2(targetPrice),
    stopLoss: round2(stopLoss),
    timeHorizon,
    reasoning,
    riskFactors: [
      "AI analysis unavailable — technical fallback levels",
      "Market volatility",
    ],
  };
}

/** Humanise the screener attribution for the fallback reasoning. */
function flaggedBy(names: string): string {
  return names === "screeners" ? "flagged by screeners" : `flagged by ${names}`;
}
