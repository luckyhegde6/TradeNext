/**
 * Pure row encoders for the Tracker spreadsheet (spec 19 §4.C).
 *
 * ZERO IO, ZERO googleapis — every function is a `domain → string[]` map, so
 * the column contracts are unit-testable in isolation and the exporter stays a
 * dumb transport. Column ORDER mirrors `TRACKER_TABS` in `tabs.ts`; a change
 * here is a change to the user's sheet contract.
 *
 * Input types are declared STRUCTURALLY (and minimally) rather than imported
 * from the producer services: the producers own much larger objects, and a
 * structural input keeps this file free of runtime imports and of any coupling
 * that would make a producer refactor break the sheet.
 */
import type { DecisionTraceEntry } from "@/lib/services/decision/monitoring";
import type { SwingStock } from "@/lib/services/swing-types";

/**
 * Coerce any value into one spreadsheet cell.
 *
 * Never throws. `null`/`undefined`/`NaN`/`Infinity` → `""` so a bad number can
 * never poison a whole append; arrays join with `"; "` (readable, splittable in
 * Sheets); objects are JSON.
 */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return value
      .map((v) => cell(v))
      .filter((s) => s !== "")
      .join("; ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

// ─── swing ───────────────────────────────────────────────────────────────

/** One analyzed swing pick → `swing` row (24 columns). */
export function swingRow(stock: SwingStock, postedAt?: string): string[] {
  const a = stock.analysis;
  return [
    cell(postedAt ?? new Date().toISOString()),
    cell(stock.symbol),
    cell(stock.name),
    cell(stock.price),
    cell(stock.change),
    cell(stock.changePercent),
    cell(stock.volume),
    cell(stock.marketCap),
    cell(stock.screenerCount),
    cell(stock.screenerNames),
    cell(stock.families),
    cell(stock.templateIds),
    cell(stock.source),
    cell(stock.momentumScore),
    cell(stock.indicators),
    cell(a?.action),
    cell(a?.confidence),
    cell(a?.entryPrice),
    cell(a?.targetPrice),
    cell(a?.stopLoss),
    cell(a?.timeHorizon),
    cell(a?.logic),
    cell(a?.riskFactors),
    cell(stock.analysisError),
  ];
}

// ─── daily-rec ───────────────────────────────────────────────────────────

/** The AI verdict slice of a daily-recommendation stock. */
export interface DailyRecVerdict {
  recommendation?: string | null;
  confidence?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  timeHorizon?: string | null;
  reasoning?: string | null;
}

/** Minimal daily-recommendation stock shape consumed by {@link dailyRecRow}. */
export interface DailyRecStockInput {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  screenerNames?: string[];
  /** False when the AI call failed and the stock fell back to a synthetic HOLD. */
  success?: boolean;
  aiRecommendation?: DailyRecVerdict | null;
}

/** Run identity stamped on every row of one recommendation run. */
export interface DailyRecRunContext {
  runId: string;
  runDate: string;
}

/** One recommendation stock → `daily-rec` row (16 columns). */
export function dailyRecRow(
  stock: DailyRecStockInput,
  run: DailyRecRunContext
): string[] {
  const v = stock.aiRecommendation ?? undefined;
  return [
    cell(run.runDate),
    cell(run.runId),
    cell(stock.symbol),
    cell(stock.price),
    cell(stock.change),
    cell(stock.changePercent),
    cell(stock.volume),
    cell(stock.screenerNames),
    cell(stock.screenerNames?.length ?? 0),
    cell(v?.recommendation),
    cell(v?.confidence),
    cell(v?.targetPrice),
    cell(v?.stopLoss),
    cell(v?.timeHorizon),
    cell(stock.success === false ? "ai-failed" : "analyzed"),
    cell(v?.reasoning),
  ];
}

// ─── screener ────────────────────────────────────────────────────────────

/** Minimal unified-screener hit shape consumed by {@link screenerRow}. */
export interface ScreenerRowInput {
  symbol: string;
  name: string;
  /** Screener snapshot price; written to the `close` column (spec §5). */
  price: number;
  changePercent: number;
  volume: number;
  screenerNames?: string[];
  source?: string;
  /** POC A composite score — present only when DECISION_POC_ENABLED=true. */
  decisionScore?: number;
  decisionGate?: string;
}

/** Run identity stamped on every row of one unified screener pass. */
export interface ScreenerRowContext {
  capturedAt?: string;
  runId?: string;
  category?: string;
}

/** One unified-run hit → `screener` row (12 columns). */
export function screenerRow(
  result: ScreenerRowInput,
  ctx: ScreenerRowContext = {}
): string[] {
  return [
    cell(ctx.capturedAt ?? new Date().toISOString()),
    cell(ctx.runId),
    cell(result.symbol),
    cell(result.name),
    cell(result.price),
    cell(result.changePercent),
    cell(result.volume),
    cell(result.screenerNames),
    cell(ctx.category),
    cell(result.source),
    cell(result.decisionScore),
    cell(result.decisionGate),
  ];
}

// ─── custom ──────────────────────────────────────────────────────────────

/** Saved-scan identity stamped on every row of one config run. */
export interface CustomScanRowContext {
  runAt: string;
  configId: string;
  configName: string;
  userId: string;
  /** The config's filter tree — JSON'd into its own column. */
  filters: unknown;
  /** Total matches for the run (may exceed the exported page). */
  matchCount: number;
}

/**
 * Derive the ₹ change from TradingView's `change`, which is the PERCENT for NSE
 * (see `ScannedResultsTable`: the UI reconstructs the rupee amount this way).
 */
function rupeeChange(close: number, pct: number): string {
  if (!Number.isFinite(close) || !Number.isFinite(pct) || pct <= -100) return "";
  return cell((close * pct) / (100 + pct));
}

/** One saved-config scan hit → `custom` row (13 columns). */
export function customScanRow(
  item: Record<string, unknown>,
  ctx: CustomScanRowContext
): string[] {
  const close = Number(item.close);
  const pct = Number(item.change ?? item.change_percent);
  const rawSymbol = String(item.symbol ?? item.name ?? "");
  return [
    cell(ctx.runAt),
    cell(ctx.configId),
    cell(ctx.configName),
    cell(ctx.userId),
    cell(ctx.filters),
    cell(ctx.matchCount),
    // TradingView returns `NSE:SYMBOL`; the rest of TradeNext stores bare tickers.
    cell(rawSymbol.replace(/^NSE:/i, "")),
    cell(item.name),
    cell(close),
    rupeeChange(close, pct),
    cell(pct),
    cell(item.volume),
    cell(item),
  ];
}

// ─── decisions ───────────────────────────────────────────────────────────

/** One decision-engine trace → `decisions` row (16 columns). */
export function decisionRow(entry: DecisionTraceEntry): string[] {
  return [
    cell(entry.timestamp),
    cell(entry.kind),
    cell(entry.mode),
    cell(entry.provider),
    cell(entry.status),
    cell(entry.latencyMs),
    cell(entry.attempts),
    cell(entry.error),
    cell(entry.questionCount),
    cell(entry.questionTypes),
    cell(entry.gate),
    cell(entry.reason),
    cell(entry.scoredCount),
    cell(entry.gateDistribution),
    cell(entry.noulAmount),
    cell(entry.allowed),
  ];
}
