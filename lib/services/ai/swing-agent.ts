/**
 * Swing Analysis Agent — analyzes stocks flagged by the swing-trading Chartink
 * screeners and predicts swing targets/stops from momentum + indicators.
 *
 * Uses directPrompt() (no tool calling — stock data + indicators are pre-fetched).
 * Processes in batches of 5, bounded concurrency 3, hard 5-min per-batch cap —
 * mirrors recommendation-agent's v3.8.0 hardening (retry on unusable responses,
 * fail fast, never accept an unparseable/truncated answer as a "successful" batch).
 */
import { directPrompt, getPromptTimeoutMs } from "./llm-provider";
import { hasValidConfig, type AIConfig } from "./config";
import { modelFallbackChain } from "./modelChain";
import { trackAiCall } from "./ai-monitoring";
import { evaluateRecommendationLevels } from "@/lib/services/recommendationLevelEvaluator";
import type {
  SwingAction,
  SwingAnalysis,
  SwingTimeHorizon,
} from "@/lib/services/swing-types";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export interface SwingAnalysisInput {
  symbol: string;
  price: number;
  changePercent: number;
  volume: number;
  /** Swing screener tags that flagged this stock. */
  screenerNames: string[];
  /** Segregated signal families (trend/breakout/reversal/momentum/volume/range). */
  families: string[];
  marketCap?: number;
  momentum10: number | null;
  momentum20: number | null;
  volatility20: number | null;
  distanceFrom20dHigh: number | null;
}

export interface SwingAnalysisResult extends SwingAnalysisInput {
  analysis: SwingAnalysis | null;
  tokensUsed: number;
  executionMs: number;
  success: boolean;
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────

const BATCH_SIZE = 5;
const RETRY_MAX = 2;
const RETRY_BASE_DELAY_MS = 1500;
const MAX_RETRY_DELAY_MS = 8000;
const CONCURRENCY = 3;
const BATCH_TIMEOUT_MS = 5 * 60_000;

const SYSTEM_PROMPT_SWING = `You are a senior Indian swing trader specializing in NSE-listed stocks. Swing trading means holding positions from a few days to a few weeks, riding momentum and trend.

Each stock was flagged by one or more swing-trading screeners. For every stock you receive: the screener tags that flagged it, the signal families those screeners belong to (trend, breakout, reversal, momentum, volume, range), and momentum/indicator data derived from the last ~20 trading sessions.

RULES:
1. For each stock, respond with a JSON object with exactly these fields: symbol, action, confidence, entryPrice, targetPrice, stopLoss, timeHorizon, logic, momentumScore, riskFactors.
2. action must be one of: LONG (bullish swing setup), SHORT (bearish swing setup), OBSERVE (no actionable edge right now).
3. confidence is an integer 0–100.
4. entryPrice, targetPrice, stopLoss are in INR. For LONG: entryPrice near the current price, targetPrice above entryPrice, stopLoss below entryPrice. For SHORT: targetPrice below entryPrice, stopLoss above entryPrice. For OBSERVE keep target/stop within ~1–3% of the price.
5. Predict targets from MOMENTUM and INDICATORS: strong momentum20 with low volatility supports a wider target; high volatility demands a wider stop; distanceFrom20dHigh of 0 means the stock is at its recent high (breakout context), a large value means it is pulling back (mean-reversion context).
6. timeHorizon: short (2–5 sessions), medium (1–3 weeks), long (1–3 months).
7. logic: 2–3 sentences. EXPLAIN the screener-tag logic — why the flagged screeners and their families matter for this stock — and how the indicators support the target.
8. momentumScore is an integer 0–100 rating the momentum setup quality.
9. riskFactors is an array of 1–3 strings.
10. Output MUST be a valid JSON array — one object per stock, in the same order as the input list. No markdown, no commentary.`;

const RESPONSE_SCHEMA_HINT_SWING = `Return a JSON array like:
[
  {
    "symbol": "RELIANCE",
    "action": "LONG",
    "confidence": 72,
    "entryPrice": 2950,
    "targetPrice": 3200,
    "stopLoss": 2810,
    "timeHorizon": "medium",
    "logic": "Flagged by Supertrend (7,1) Trend Finder and Swing Breakout — trend + breakout families agree the stock is above the supertrend line with a fresh swing high. 20-session momentum of +14% with low volatility supports continuation to the measured move.",
    "momentumScore": 78,
    "riskFactors": ["Gap-down risk on index weakness", "Sector rotation"]
  }
]`;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Analyze a list of swing stocks in batches of 5 (bounded-concurrency pool).
 * Partial failures are graceful — failed stocks get OBSERVE defaults with a
 * price-derived entry/target/stop so the UI never shows broken levels.
 * Results preserve input order regardless of completion order.
 */
export async function analyzeSwingStocks(
  stocks: SwingAnalysisInput[],
  config?: AIConfig,
): Promise<SwingAnalysisResult[]> {
  if (!hasValidConfig(config)) {
    logger.warn({ msg: "AI not configured, skipping swing analysis" });
    return stocks.map((s) => failedSwingResult(s, "AI is not configured"));
  }

  const results: SwingAnalysisResult[] = new Array(stocks.length);
  const totalBatches = Math.ceil(stocks.length / BATCH_SIZE);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < stocks.length) {
      const i = nextIndex;
      nextIndex += BATCH_SIZE;
      const batch = stocks.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE);

      logger.info({
        msg: "Analyzing swing batch",
        batchIndex: batchIndex + 1,
        of: totalBatches,
        symbols: batch.map((s) => s.symbol),
      });

      try {
        const batchResults = await analyzeSwingBatch(batch, config);
        batchResults.forEach((r, idx) => {
          results[i + idx] = r;
        });
      } catch (e) {
        logger.warn({
          msg: "Swing batch analysis failed",
          batchIndex: batchIndex + 1,
          error: e instanceof Error ? e.message : String(e),
        });
        batch.forEach((stock, idx) => {
          results[i + idx] = failedSwingResult(
            stock,
            e instanceof Error ? e.message : String(e),
          );
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, totalBatches) }, () => worker()),
  );

  logger.info({
    msg: "Swing analysis complete",
    total: stocks.length,
    succeeded: results.filter((r) => r && r.success).length,
    failed: results.filter((r) => !r || !r.success).length,
  });

  return results;
}

// ─── Internal ────────────────────────────────────────────────────────────

/** Analyze one batch of up to 5 stocks with retry + model fallback (deadline-capped like v3.8.0). */
async function analyzeSwingBatch(
  stocks: SwingAnalysisInput[],
  config?: AIConfig,
): Promise<SwingAnalysisResult[]> {
  const prompt = buildSwingAnalysisPrompt(stocks);
  const batchDeadline = Date.now() + BATCH_TIMEOUT_MS;
  // Model fallback chain (v3.10.1): primary gets RETRY_MAX attempts, each
  // fallback route one attempt — a dead primary no longer kills the batch.
  const chain = modelFallbackChain(config?.model);
  let lastError: string | undefined;
  let attemptsMade = 0;
  let usedModel: string | undefined;

  for (const model of chain) {
    // Primary uses the caller's config as-is; fallbacks swap the model only.
    // analyzeSwingStocks guards hasValidConfig(config) before this runs.
    const modelConfig =
      model === config?.model ? config : { ...(config as AIConfig), model };
    const attempts = model === config?.model ? RETRY_MAX : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      attemptsMade++;
      const remaining = batchDeadline - Date.now();
      if (remaining <= 0) {
        lastError = `Batch exceeded ${BATCH_TIMEOUT_MS / 1000}s timeout`;
        logger.warn({ msg: "Swing batch timed out", model, attempt, error: lastError });
        break;
      }

      const attemptStart = Date.now();
      let response: string;
      try {
        response = await directPrompt(
          prompt,
          modelConfig,
          Math.min(remaining, getPromptTimeoutMs()),
        );
        usedModel = model;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        logger.warn({
          msg: "Swing batch attempt failed",
          model,
          attempt,
          of: attempts,
          error: lastError,
        });
        if (attempt < attempts) await sleep(retryDelay(attempt));
        continue;
      }
      const attemptMs = Date.now() - attemptStart;

      const raw = typeof response === "string" ? response : "";

      const analyses = parseSwingResponse(raw, stocks);
      if (!analyses) {
        lastError = `Unusable AI response (${describeUnusable(raw)})`;
        logger.warn({
          msg: "Swing batch response unusable — retrying",
          model,
          attempt,
          of: attempts,
          error: lastError,
          preview: raw.slice(0, 200),
        });
        if (attempt < attempts) await sleep(retryDelay(attempt));
        continue;
      }

      const batchResults = stocks.map((stock, idx) => {
        const analysis = analyses[idx];
        if (!analysis) {
          return failedSwingResult(stock, "No analysis returned for this stock");
        }
        return {
          ...stock,
          analysis,
          tokensUsed: estimateTokens(prompt) + estimateTokens(raw),
          executionMs: attemptMs,
          success: true,
        };
      });

      await trackAiCall({
        timestamp: new Date().toISOString(),
        action: "swing_analysis_batch",
        model: usedModel || "unknown",
        status: "success",
        tokensUsed: batchResults.reduce((sum, r) => sum + r.tokensUsed, 0),
        responseTimeMs: attemptMs,
        analysisType: "swing",
        prompt: prompt.slice(0, 500),
        result: raw.slice(0, 1000),
      });

      return batchResults;
    }

    // Deadline hit — no point trying more models.
    if (Date.now() >= batchDeadline) break;
  }

  await trackAiCall({
    timestamp: new Date().toISOString(),
    action: "swing_analysis_batch",
    model: usedModel || config?.model || "unknown",
    status: "error",
    tokensUsed: 0,
    responseTimeMs: 0,
    analysisType: "swing",
    error: lastError || "unknown",
    prompt: prompt.slice(0, 500),
  });

  throw new Error(
    `Swing AI analysis failed — ${friendlySwingFailure(lastError)} (${attemptsMade} attempt(s) across ${chain.length} model(s))`,
  );
}

/**
 * Map a raw batch failure onto a human-readable phrase (surfaced on the swing
 * cards' "AI targets unavailable" message and in the audit log). Exported for
 * tests; unknown errors pass through unchanged.
 */
export function friendlySwingFailure(lastError?: string): string {
  const e = lastError ?? "unknown error";
  if (e.startsWith("Unusable AI response (empty response)")) return "the model returned an empty response";
  if (e.startsWith("Unusable AI response (provider error)")) return "the AI provider returned an error";
  if (e.startsWith("Unusable AI response (empty content)")) return "the model returned no content";
  if (e.startsWith("Unusable AI response (unparseable JSON)")) return "the model's response was not valid JSON";
  if (e.startsWith("Batch exceeded")) return "the analysis timed out";
  return e;
}

function describeUnusable(response: string): string {
  const t = response.trim();
  if (!t) return "empty response";
  if (t.startsWith("AI request failed")) return "provider error";
  if (t.includes("No response from AI")) return "empty content";
  return "unparseable JSON";
}

/** Build the analysis prompt for a batch of swing stocks. */
export function buildSwingAnalysisPrompt(stocks: SwingAnalysisInput[]): string {
  const stockLines = stocks
    .map((s, i) => {
      const indicators = [
        s.momentum20 != null ? `momentum20: ${s.momentum20.toFixed(1)}%` : "momentum20: n/a",
        s.momentum10 != null ? `momentum10: ${s.momentum10.toFixed(1)}%` : "momentum10: n/a",
        s.volatility20 != null ? `volatility20: ${s.volatility20.toFixed(1)}%` : "volatility20: n/a",
        s.distanceFrom20dHigh != null
          ? `distanceFrom20dHigh: ${s.distanceFrom20dHigh.toFixed(1)}%`
          : "distanceFrom20dHigh: n/a",
      ].join(", ");
      return (
        `${i + 1}. ${s.symbol} — Price: ₹${s.price}, Change: ${s.changePercent >= 0 ? "+" : ""}${s.changePercent}%, ` +
        `Volume: ${formatVolume(s.volume)}${s.marketCap ? `, Market Cap: ₹${formatMarketCap(s.marketCap)}` : ""}\n` +
        `   Signal families: ${s.families.length > 0 ? s.families.join(", ") : "n/a"}\n` +
        `   Screeners: ${s.screenerNames.join(", ") || "n/a"}\n` +
        `   Indicators: ${indicators}`
      );
    })
    .join("\n");

  return `${SYSTEM_PROMPT_SWING}

Analyze these NSE swing candidates and return a JSON array with one analysis per stock. Use the screener tags and their families to explain the setup, and the momentum/indicators to size the target and stop.

${stockLines}

${RESPONSE_SCHEMA_HINT_SWING}

IMPORTANT: Return ONLY the JSON array. No markdown, no explanation.`;
}

/**
 * Parse the AI response into structured swing analyses.
 * Returns null when unusable — unparseable, or missing one or more stocks
 * (e.g. JSON truncated at the maxTokens cap). Caller retries on null.
 * Symbol matching is order-independent; index position is a lenient fallback.
 */
export function parseSwingResponse(
  response: string,
  stocks: SwingAnalysisInput[],
): SwingAnalysis[] | null {
  let parsed = tryParseJSON(response);
  if (!parsed) parsed = extractFromCodeBlock(response);
  if (!parsed) parsed = extractJSONArray(response);

  if (!Array.isArray(parsed)) {
    logger.warn({ msg: "Failed to parse swing AI response into array", preview: response.slice(0, 200) });
    return null;
  }

  const analyses: SwingAnalysis[] = [];
  for (let idx = 0; idx < stocks.length; idx++) {
    const stock = stocks[idx];
    const raw = findAnalysisBySymbol(parsed, stock.symbol) || parsed[idx];

    if (!raw) {
      logger.warn({
        msg: "Swing AI response missing stock — treating as unusable",
        symbol: stock.symbol,
        responseCount: parsed.length,
      });
      return null;
    }

    analyses.push(normalizeSwingAnalysis(raw, stock));
  }

  return analyses;
}

/** Export for tests — the pure direction-aware normalizer. */
export function normalizeSwingAnalysis(
  raw: Record<string, unknown>,
  stock: SwingAnalysisInput,
): SwingAnalysis {
  const action: SwingAction =
    toUpper(raw.action) === "LONG" || toUpper(raw.action) === "SHORT"
      ? (toUpper(raw.action) as SwingAction)
      : "OBSERVE";
  const direction = action === "LONG" ? "BUY" : action === "SHORT" ? "SELL" : "HOLD";

  const confidence = clamp(toNumber(raw.confidence), 0, 100);
  const momentumScore = clamp(toNumber(raw.momentumScore), 0, 100);

  const rawEntry = toNumber(raw.entryPrice) > 0 ? toNumber(raw.entryPrice) : stock.price;
  const entryPrice = clampEntry(action, rawEntry, stock.price);

  // Direction-aware target/SL — the ITC-bug guard: LONG target>entry>stop,
  // SHORT inverted, OBSERVE tight band; falls back to price-based defaults.
  const evaluation = evaluateRecommendationLevels({
    direction,
    price: entryPrice,
    targetPrice: toNumber(raw.targetPrice),
    stopLoss: toNumber(raw.stopLoss),
  });

  if (!evaluation.valid && evaluation.corrections.length > 0) {
    logger.warn({
      msg: "Swing levels corrected by evaluator",
      symbol: stock.symbol,
      action,
      corrections: evaluation.corrections,
    });
  }

  const horizon = toUpper(raw.timeHorizon);
  const validHorizon: SwingTimeHorizon =
    horizon === "SHORT" || horizon === "LONG"
      ? (horizon.toLowerCase() as SwingTimeHorizon)
      : "medium";

  const logic =
    typeof raw.logic === "string" && raw.logic.trim()
      ? raw.logic.slice(0, 600)
      : `${stock.symbol} flagged by swing screeners (${stock.families.join(", ") || "trend"} family) — monitor for confirmation.`;

  const riskFactors = Array.isArray(raw.riskFactors)
    ? raw.riskFactors.filter((r): r is string => typeof r === "string").slice(0, 5)
    : ["Market volatility"];

  return {
    action,
    confidence,
    entryPrice: round2(entryPrice),
    targetPrice: evaluation.targetPrice,
    stopLoss: evaluation.stopLoss,
    timeHorizon: validHorizon,
    logic,
    momentumScore,
    riskFactors,
  };
}

// ─── Parsing helpers (mirrors recommendation-agent) ──────────────────────

function findAnalysisBySymbol(
  arr: Record<string, unknown>[],
  symbol: string,
): Record<string, unknown> | undefined {
  return arr.find(
    (item) =>
      typeof item.symbol === "string" && item.symbol.toUpperCase() === symbol.toUpperCase(),
  );
}

function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function extractFromCodeBlock(text: string): unknown | null {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (match) return tryParseJSON(match[1]);
  return null;
}

function extractJSONArray(text: string): unknown | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return tryParseJSON(text.slice(start, end + 1));
}

// ─── Utility helpers ─────────────────────────────────────────────────────

/** Keep the AI's entry near the current price per action semantics. */
function clampEntry(action: SwingAction, entry: number, price: number): number {
  if (price <= 0) return entry;
  switch (action) {
    case "LONG":
      return clamp(entry, price * 0.95, price * 1.02);
    case "SHORT":
      return clamp(entry, price * 0.98, price * 1.05);
    default:
      return price;
  }
}

/** Price-based OBSERVE default used when AI analysis is unavailable. */
function getDefaultSwingAnalysis(stock?: Pick<SwingAnalysisInput, "price">): SwingAnalysis {
  const price = stock?.price ?? 0;
  const band = (n: number) => Math.round(n * 100) / 100;
  return {
    action: "OBSERVE",
    confidence: 40,
    entryPrice: band(price),
    targetPrice: price > 0 ? band(price * 1.03) : 0,
    stopLoss: price > 0 ? band(price * 0.97) : 0,
    timeHorizon: "medium",
    logic: "AI analysis unavailable — observing price action.",
    momentumScore: 0,
    riskFactors: ["Analysis failed"],
  };
}

function failedSwingResult(stock: SwingAnalysisInput, error: string): SwingAnalysisResult {
  return {
    ...stock,
    analysis: getDefaultSwingAnalysis(stock),
    tokensUsed: 0,
    executionMs: 0,
    success: false,
    error,
  };
}

function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
}

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val.replace(/[₹,%]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function toUpper(val: unknown): string {
  return typeof val === "string" ? val.toUpperCase() : "";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatVolume(vol: number): string {
  if (vol >= 1e7) return `${(vol / 1e7).toFixed(1)}Cr`;
  if (vol >= 1e5) return `${(vol / 1e5).toFixed(1)}L`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return String(vol);
}

function formatMarketCap(mc: number): string {
  if (mc >= 1e11) return `${(mc / 1e11).toFixed(2)}L Cr`;
  if (mc >= 1e9) return `${(mc / 1e7).toFixed(1)}Cr`;
  if (mc >= 1e7) return `${(mc / 1e7).toFixed(1)}Cr`;
  return String(mc);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
