/**
 * KPI aggregation for the Tracker's `metrics` tab (spec 20, plan steps 9/10/24/29).
 *
 * WHAT THIS IS FOR
 * The other five tabs log *events* (a pick, a scan hit, a decision trace). This
 * one logs a periodic snapshot of how those picks actually performed, so the
 * user's Tracker becomes a time series of recommendation health they can chart
 * without exporting anything.
 *
 * IT IS A PROJECTION, NOT A NEW SOURCE OF TRUTH
 * Every number here is derived from `RecommendationTracker`, which the
 * performance tracker already owns and already updates. This service reads; it
 * never writes, never archives, and never re-derives a price. If the KPI and the
 * Performance tab ever disagree, the Performance tab is right.
 *
 * THE MATH IS DEFINED HERE, ONCE, DELIBERATELY
 * "Win rate" and "net P&L" are the two numbers a tracker sheet is judged by, and
 * both have more than one honest definition. These are the choices, and they are
 * fixed so the sheet stays comparable over time:
 *
 *   closed    a pick with a decided outcome: target_achieved | stop_loss_hit |
 *             expired. `active` picks are NOT closed and never enter any P&L.
 *   wins      target_achieved.
 *   winRate   wins / decided-with-an-outcome, as a PERCENTAGE 0..100.
 *             `expired` is excluded from the denominator: time running out is
 *             neither a win nor a loss, and counting it would drag the number
 *             toward 0 for reasons that have nothing to do with accuracy.
 *             `null` when nothing has been decided yet — a measured 0% would be
 *             a lie, and `cell(null)` renders blank.
 *   pnl       per-share rupees. The tracker has no quantity column, so this is
 *             rupee-per-share, NOT portfolio value. Summed over closed picks.
 *             Exit price follows the outcome, because using `currentPrice` for a
 *             pick that hit its target would re-measure a closed trade at
 *             today's price: target_achieved -> targetPrice,
 *             stop_loss_hit -> stopLoss, expired -> last known currentPrice.
 *   grossPnl  sum of |pnl| — the churn before direction. netPnl alone hides how
 *             much a strategy moved while ending flat.
 *   avgReturnPct  mean of pnl/entryPrice*100 over closed picks.
 *   netPnlPct     netPnl / total entry capital of closed picks — return on
 *                 deployed capital. `null` when that capital is 0.
 *
 * `winRate` is a percentage 0..100 to match the existing
 * `portfolioRiskMetricsService.winRate` convention in this repo, NOT a 0..1
 * fraction. Two different win rates exist in TradeNext (that one counts positive
 * *days* in a price history); this one counts decided *picks*. Same unit, so a
 * user reading both is not misled by one being 0.62 and the other 62.
 */
import prisma from "@/lib/prisma";
import { isDbUnavailableError, isPlanLimitBreakerOpen } from "@/lib/db-utils";
import logger from "@/lib/logger";
import type { MetricsRowInput } from "./rows";

/** A computed KPI snapshot — the 11 `metrics` columns, pre-encoding. */
export type MetricsSnapshot = MetricsRowInput;

/**
 * Degraded result. Never throw a bare error at the console: a 500 would hide
 * every other panel, and a `null` snapshot would render as "0% win rate" —
 * indistinguishable from a real, terrible number (Lesson 138).
 */
export type MetricsResult =
  | { ok: true; snapshot: MetricsSnapshot }
  | { ok: false; reason: "db_unavailable" | "error"; detail?: string };

/** The subset of a tracker row the math needs. Structurally minimal. */
export interface TrackedPick {
  status: string;
  entryPrice: number;
  currentPrice: number | null;
  targetPrice: number;
  stopLoss: number;
}

/** Round to 2dp. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A RATIO as a PERCENTAGE 0..100, or null when not computable.
 *
 * The `* 100` lives in this one function on purpose. `winRate` was originally
 * a bare `div(wins, decided)` and silently produced 0.5 where the header and
 * the rest of the repo say percent — a bug only a value-pinned test could catch.
 * One helper makes the unit a property of the function name instead of a
 * convention someone has to remember.
 */
function pct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return r2((numerator / denominator) * 100);
}

/** The realized rupee-per-share outcome of a closed pick, or null if still open. */
function closedPnl(p: TrackedPick): number | null {
  switch (p.status) {
    case "target_achieved":
      return p.targetPrice - p.entryPrice;
    case "stop_loss_hit":
      return p.stopLoss - p.entryPrice;
    case "expired":
      // An expired pick is closed at whatever the last known price was. No price
      // on record means we genuinely do not know the outcome — returning 0 here
      // would quietly count an unknown as a break-even trade.
      return p.currentPrice == null ? null : p.currentPrice - p.entryPrice;
    default:
      return null; // active, or any status we do not recognise
  }
}

/**
 * Pure KPI math. Exported (and separated from the Prisma read) so the arithmetic
 * is unit-testable without a database — the numbers are the contract.
 *
 * `snapshotAt` is a parameter, not `new Date()`, so a test can pin it.
 */
export function computeMetrics(picks: TrackedPick[], snapshotAt: string): MetricsSnapshot {
  let targetAchieved = 0;
  let stopLossHit = 0;
  let expired = 0;
  let active = 0;

  let netPnlAbs = 0;
  let grossPnlAbs = 0;
  let capital = 0;
  let returnSum = 0;
  let returnCount = 0;
  // `decided` counts outcomes only; `expired` is excluded from the win-rate
  // denominator on purpose (see the file header).
  let decided = 0;

  for (const p of picks) {
    if (p.status === "target_achieved") targetAchieved++;
    else if (p.status === "stop_loss_hit") stopLossHit++;
    else if (p.status === "expired") expired++;
    else if (p.status === "active") active++;

    const pnl = closedPnl(p);
    if (pnl === null) continue;
    netPnlAbs += pnl;
    grossPnlAbs += Math.abs(pnl);
    if (p.entryPrice > 0) {
      capital += p.entryPrice;
      returnSum += (pnl / p.entryPrice) * 100;
      returnCount++;
    }
    if (p.status !== "expired") decided++;
  }

  return {
    snapshotAt,
    totalTracked: picks.length,
    active,
    targetAchieved,
    stopLossHit,
    expired,
    winRate: pct(targetAchieved, decided),
    netPnlAbs: r2(netPnlAbs),
    netPnlPct: pct(netPnlAbs, capital),
    avgReturnPct: returnCount > 0 ? r2(returnSum / returnCount) : null,
    grossPnlAbs: r2(grossPnlAbs),
  };
}

/**
 * Read every tracked pick and compute the snapshot.
 *
 * Returns a discriminated result instead of throwing: under the P6003 hold the
 * tracker table is unreachable, and the console must say so rather than show a
 * confident row of zeros that the user would then append to their sheet.
 */
export async function getMetrics(): Promise<MetricsResult> {
  if (isPlanLimitBreakerOpen()) {
    return { ok: false, reason: "db_unavailable" };
  }
  try {
    const rows = await prisma.recommendationTracker.findMany({
      select: { status: true, entryPrice: true, currentPrice: true, targetPrice: true, stopLoss: true },
    });
    return { ok: true, snapshot: computeMetrics(rows, new Date().toISOString()) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isDbUnavailableError(error)) {
      logger.warn({ msg: "Google Sheets metrics: DB unavailable", detail });
      return { ok: false, reason: "db_unavailable" };
    }
    logger.error({ msg: "Google Sheets metrics: aggregation failed", detail });
    return { ok: false, reason: "error", detail };
  }
}
