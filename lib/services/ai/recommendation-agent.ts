/**
 * Daily Recommendation Agent — Analyzes stocks flagged by screeners
 * and generates BUY/HOLD/SELL recommendations with AI reasoning.
 *
 * Uses directPrompt() (no tool calling needed — stock data is pre-fetched).
 * Processes in batches of 5 to stay within token limits.
 */
import { directPrompt, getPromptTimeoutMs, isQuotaExhausted, QUOTA_EXHAUSTED_MESSAGE } from "./llm-provider";
import { hasValidConfig, type AIConfig } from "./config";
import { modelFallbackChain } from "./modelChain";
import { trackAiCall } from "./ai-monitoring";
import { formatStockContext, type StockContext } from "./recommendation-context";
import { evaluateRecommendationLevels } from "@/lib/services/recommendationLevelEvaluator";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export interface AIRecommendation {
  recommendation: "BUY" | "HOLD" | "SELL";
  confidence: number; // 0–100
  targetPrice: number;
  stopLoss: number;
  timeHorizon: "short" | "medium" | "long";
  reasoning: string;
  riskFactors: string[];
}

export interface StockAnalysisInput {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  screenerNames: string[]; // which screeners flagged this stock
  marketCap?: number; // ₹ market cap (used for ranking, included in prompt)
  /** Fundamental context (corp actions, announcements, results) — optional, batched once per run. */
  context?: StockContext;
}

export interface StockAnalysisResult extends StockAnalysisInput {
  aiRecommendation: AIRecommendation;
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

/** Number of batch workers running concurrently (OpenRouter free-tier friendly). */
const CONCURRENCY = 5;

/**
 * Hard per-batch wall-clock cap (5 minutes), covering ALL retry attempts for
 * one batch — never exceeded even if the per-request timeout is raised.
 * A dead/saturated model must fail fast, not hold the pipeline past the
 * Netlify 14-minute background-function safety net.
 */
const BATCH_TIMEOUT_MS = 5 * 60_000;

function retryDelay(attempt: number): number {
  return Math.min(
    RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
    MAX_RETRY_DELAY_MS,
  );
}

/** Fallback target/SL multipliers used when AI cannot determine a target (mirrors dailyRecommendationService). */
const DEFAULT_TARGET_MULTIPLIER = 1.1;
const DEFAULT_STOP_LOSS_MULTIPLIER = 0.95;

const SYSTEM_PROMPT = `You are a senior Indian stock market analyst for NSE-listed stocks. You analyze stocks based on price data, momentum, volume, and screener signals to produce actionable recommendations.

RULES:
1. For each stock, respond with a JSON object containing exactly these fields: recommendation, confidence, targetPrice, stopLoss, timeHorizon, reasoning, riskFactors.
2. recommendation must be one of: BUY, HOLD, SELL.
3. confidence is an integer 0–100 representing your conviction.
4. targetPrice and stopLoss are in INR (same scale as the input price). Set to 0 if not determinable.
5. timeHorizon is one of: short (< 1 month), medium (1–3 months), long (> 3 months).
6. reasoning is a concise 1–2 sentence explanation.
7. riskFactors is an array of 1–3 strings describing key risks.
8. Output MUST be a valid JSON array — one object per stock, in the same order as the input list.
9. Do NOT include markdown, commentary, or text outside the JSON array.`;

const RESPONSE_SCHEMA_HINT = `Return a JSON array like:
[
  {
    "symbol": "RELIANCE",
    "recommendation": "BUY",
    "confidence": 75,
    "targetPrice": 2950,
    "stopLoss": 2700,
    "timeHorizon": "medium",
    "reasoning": "Strong momentum with above-average volume and bullish screener signals.",
    "riskFactors": ["High P/E relative to sector", "Crude oil price sensitivity"]
  }
]`;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Analyze a list of stocks in batches of 5.
 * Partial failures are graceful — failed stocks get HOLD defaults.
 *
 * Batches run on a bounded-concurrency worker pool (CONCURRENCY=5): a
 * 50-stock run drops from ~10 sequential 30-90s calls to ~4 waves, keeping
 * the whole AI phase inside the 14-minute background-function safety net.
 * Results preserve input order regardless of completion order.
 */
export async function analyzeStocks(
  stocks: StockAnalysisInput[],
  config?: AIConfig
): Promise<StockAnalysisResult[]> {
  if (!hasValidConfig(config)) {
    logger.warn({ msg: "AI not configured, skipping recommendation analysis" });
    return stocks.map((s) => failedResult(s, "AI is not configured"));
  }

  const results: StockAnalysisResult[] = new Array(stocks.length);
  const totalBatches = Math.ceil(stocks.length / BATCH_SIZE);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    // Claims are synchronous (no await between read+increment), so each batch
    // is assigned to exactly one worker, in order.
    while (nextIndex < stocks.length) {
      const i = nextIndex;
      nextIndex += BATCH_SIZE;
      const batch = stocks.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE);

      logger.info({
        msg: "Analyzing batch",
        batchIndex: batchIndex + 1,
        of: totalBatches,
        symbols: batch.map((s) => s.symbol),
      });

      try {
        const batchResults = await analyzeBatch(batch, config);
        batchResults.forEach((r, idx) => {
          results[i + idx] = r;
        });
      } catch (e) {
        logger.warn({
          msg: "Batch analysis failed",
          batchIndex: batchIndex + 1,
          error: e instanceof Error ? e.message : String(e),
        });
        batch.forEach((stock, idx) => {
          results[i + idx] = failedResult(stock, e instanceof Error ? e.message : String(e));
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, totalBatches) }, () => worker()),
  );

  logger.info({
    msg: "Stock analysis complete",
    total: stocks.length,
    succeeded: results.filter((r) => r && r.success).length,
    failed: results.filter((r) => !r || !r.success).length,
  });

  return results;
}

/**
 * Analyze a single stock (convenience wrapper).
 */
export async function analyzeSingleStock(
  stock: StockAnalysisInput,
  config?: AIConfig
): Promise<StockAnalysisResult> {
  const results = await analyzeStocks([stock], config);
  return results[0];
}

// ─── Internal ────────────────────────────────────────────────────────────

/**
 * Analyze a single batch of up to 5 stocks with retry + model fallback.
 *
 * VERIFICATION (v3.8.0): directPrompt never throws — it converts failures
 * into strings ("AI request failed…", "No response from AI.", empty content
 * on timeouts). Previously that meant an empty/timed-out/truncated answer was
 * accepted as a "successful" batch and silently produced all-HOLD defaults
 * with NO retry. Now the response must parse into a recommendation for EVERY
 * stock in the batch; anything else counts as an attempt failure and is
 * retried (up to RETRY_MAX).
 *
 * MODEL FALLBACK (v3.10.1): the primary model gets RETRY_MAX attempts; if it
 * is dead (404 / consistently unusable — the prod all-HOLD root cause), the
 * batch falls through to {@link AI_FALLBACK_MODELS} (one attempt each) so a
 * single broken model cannot kill the batch. The whole chain is bounded by
 * the hard per-batch deadline.
 */
async function analyzeBatch(
  stocks: StockAnalysisInput[],
  config?: AIConfig
): Promise<StockAnalysisResult[]> {
  const prompt = buildAnalysisPrompt(stocks);
  // Hard per-batch deadline: the whole retry loop (models + attempts +
  // backoffs) must finish within BATCH_TIMEOUT_MS. Each attempt's request
  // timeout is clamped to the remaining budget so a single call cannot
  // overrun the cap.
  const batchDeadline = Date.now() + BATCH_TIMEOUT_MS;
  const chain = modelFallbackChain(config?.model);
  let lastError: string | undefined;
  let attemptsMade = 0;
  let usedModel: string | undefined;

  for (const model of chain) {
    // Primary uses the caller's config as-is; fallbacks swap the model only.
    // analyzeStocks guards hasValidConfig(config) before this runs, so config
    // is always populated here (the cast is for TS narrowing only).
    const modelConfig =
      model === config?.model ? config : { ...(config as AIConfig), model };
    const attempts = model === config?.model ? RETRY_MAX : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      attemptsMade++;
      const remaining = batchDeadline - Date.now();
      if (remaining <= 0) {
        lastError = `Batch exceeded ${BATCH_TIMEOUT_MS / 1000}s timeout`;
        logger.warn({ msg: "Batch timed out", model, attempt, error: lastError });
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
          msg: "Batch attempt failed",
          model,
          attempt,
          of: attempts,
          error: lastError,
        });
        if (attempt < attempts) await sleep(retryDelay(attempt));
        continue;
      }
      const attemptMs = Date.now() - attemptStart;

      // Guard: mocks/network may yield non-string — treat as empty.
      const raw = typeof response === "string" ? response : "";

      // 429/402 early-exit: daily quota exhausted — retries and fallbacks will
      // also fail, so stop immediately to save requests.
      if (isQuotaExhausted(raw)) {
        lastError = QUOTA_EXHAUSTED_MESSAGE;
        logger.warn({
          msg: "Rate limited — stopping batch (quota exhausted)",
          model,
          attempt,
          preview: raw.slice(0, 200),
        });
        // Track the 429 for monitoring visibility
        await trackAiCall({
          timestamp: new Date().toISOString(),
          action: "recommendation_batch",
          model,
          status: "error",
          tokensUsed: 0,
          responseTimeMs: attemptMs,
          analysisType: "recommendation",
          error: lastError,
          prompt: prompt.slice(0, 500),
        });
        // Throw to stop all remaining batches in analyzeStocks()
        throw new Error(lastError);
      }

      const recommendations = parseAIResponse(raw, stocks);
      if (!recommendations) {
        lastError = `Unusable AI response (${describeUnusable(raw)})`;
        logger.warn({
          msg: "Batch response unusable — retrying",
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
        const rec = recommendations[idx];
        if (!rec) {
          return failedResult(stock, "No recommendation returned for this stock");
        }
        return {
          ...stock,
          aiRecommendation: rec,
          tokensUsed: estimateTokens(prompt) + estimateTokens(raw),
          executionMs: attemptMs,
          success: true,
        };
      });

      // Track AI call for monitoring (await so it persists)
      await trackAiCall({
        timestamp: new Date().toISOString(),
        action: "recommendation_batch",
        model: usedModel || "unknown",
        status: "success",
        tokensUsed: batchResults.reduce((sum, r) => sum + r.tokensUsed, 0),
        responseTimeMs: attemptMs,
        analysisType: "recommendation",
        prompt: prompt.slice(0, 500),
        result: raw.slice(0, 1000),
      });

      return batchResults;
    }

    // Deadline hit — no point trying more models.
    if (Date.now() >= batchDeadline) break;
  }

  // All retries exhausted — track failure
  await trackAiCall({
    timestamp: new Date().toISOString(),
    action: "recommendation_batch",
    model: usedModel || config?.model || "unknown",
    status: "error",
    tokensUsed: 0,
    responseTimeMs: 0,
    analysisType: "recommendation",
    error: lastError || "unknown",
    prompt: prompt.slice(0, 500),
  });

  throw new Error(
    `Batch failed after ${attemptsMade} attempts (${chain.length} models): ${lastError || "unknown"}`,
  );
}

/**
 * Classify an unusable response for the retry log (never throws on input).
 */
function describeUnusable(response: string): string {
  const t = response.trim();
  if (!t) return "empty response";
  if (t.startsWith("AI request failed")) return "provider error";
  if (t.includes("No response from AI")) return "empty content";
  return "unparseable JSON";
}

/**
 * Build the analysis prompt for a batch of stocks.
 */
function buildAnalysisPrompt(stocks: StockAnalysisInput[]): string {
  const stockLines = stocks
    .map((s, i) => {
      const base = `${i + 1}. ${s.symbol} — Price: ₹${s.price}, Change: ${s.change >= 0 ? "+" : ""}${s.change} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent}%), Volume: ${formatVolume(s.volume)}, Screeners: ${s.screenerNames.join(", ")}${s.marketCap ? `, Market Cap: ₹${formatMarketCap(s.marketCap)}` : ""}`;
      const context = s.context ? formatStockContext(s.symbol, s.context) : "";
      return context ? `${base}\n   Context:\n${indent(context, 3)}` : base;
    })
    .join("\n");

  return `${SYSTEM_PROMPT}

Analyze these NSE stocks and return a JSON array with one recommendation per stock. When fundamental context (corporate actions, announcements, quarterly results) is provided for a stock, weigh it alongside the technical price/momentum data and mention it in your reasoning when relevant.

${stockLines}

${RESPONSE_SCHEMA_HINT}

IMPORTANT: Return ONLY the JSON array. No markdown, no explanation.`;
}

/**
 * Parse the AI response into structured recommendations.
 *
 * Returns null when the response is NOT usable — unparseable, or the array
 * lacks a recommendation for one or more stocks (e.g. JSON truncated at the
 * maxTokens cap). The caller treats null as an attempt failure and retries,
 * instead of silently accepting all-HOLD defaults from a broken response.
 * Symbol matching is order-independent; index position is a lenient fallback.
 */
function parseAIResponse(response: string, stocks: StockAnalysisInput[]): AIRecommendation[] | null {
  // Try 1: Direct JSON parse
  let parsed = tryParseJSON(response);

  // Try 2: Extract from markdown code block (```json ... ```)
  if (!parsed) {
    parsed = extractFromCodeBlock(response);
  }

  // Try 3: Find the first [ ... ] array in the response
  if (!parsed) {
    parsed = extractJSONArray(response);
  }

  if (!Array.isArray(parsed)) {
    logger.warn({ msg: "Failed to parse AI response into array", preview: response.slice(0, 200) });
    return null;
  }

  // Map parsed objects to our schema, matching by symbol (order-independent).
  const recommendations: AIRecommendation[] = [];
  for (let idx = 0; idx < stocks.length; idx++) {
    const stock = stocks[idx];
    const raw = findRecommendationBySymbol(parsed, stock.symbol) || parsed[idx];

    if (!raw) {
      logger.warn({
        msg: "AI response missing recommendation for stock — treating as unusable",
        symbol: stock.symbol,
        responseCount: parsed.length,
      });
      return null;
    }

    recommendations.push(normalizeRecommendation(raw, stock));
  }

  return recommendations;
}

/**
 * Try to find a recommendation by symbol in the parsed array.
 */
function findRecommendationBySymbol(
  arr: Record<string, unknown>[],
  symbol: string
): Record<string, unknown> | undefined {
  return arr.find(
    (item) =>
      typeof item.symbol === "string" && item.symbol.toUpperCase() === symbol.toUpperCase()
  );
}

/**
 * Normalize a raw parsed object into a valid AIRecommendation.
 */
function normalizeRecommendation(raw: Record<string, unknown>, stock: StockAnalysisInput): AIRecommendation {
  const rec = toUpper(raw.recommendation);
  const validRec = rec === "BUY" || rec === "SELL" ? rec : "HOLD";

  const confidence = clamp(toNumber(raw.confidence), 0, 100);
  // Validate + correct target/SL direction-aware (BUY: target>price>stop;
  // SELL: target<price<stop; HOLD: tight band). Falls back to price-based
  // defaults when the model returns 0/contradictory/out-of-bounds levels —
  // prevents ₹0.00 targets AND inverted SELL levels from reaching trackers.
  const evaluation = evaluateRecommendationLevels({
    direction: validRec,
    price: stock.price,
    targetPrice: toNumber(raw.targetPrice),
    stopLoss: toNumber(raw.stopLoss),
  });
  const targetPrice = evaluation.targetPrice;
  const stopLoss = evaluation.stopLoss;

  if (!evaluation.valid && evaluation.corrections.length > 0) {
    logger.warn({
      msg: "Recommendation levels corrected by evaluator",
      symbol: stock.symbol,
      direction: validRec,
      corrections: evaluation.corrections,
    });
  }

  const horizon = toUpper(raw.timeHorizon);
  const validHorizon: "short" | "medium" | "long" =
    horizon === "SHORT" || horizon === "LONG" ? (horizon.toLowerCase() as "short" | "long") : "medium";

  const reasoning =
    typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 500) : "No reasoning provided";

  const riskFactors = Array.isArray(raw.riskFactors)
    ? raw.riskFactors.filter((r): r is string => typeof r === "string").slice(0, 5)
    : ["No risk factors provided"];

  return {
    recommendation: validRec,
    confidence,
    targetPrice,
    stopLoss,
    timeHorizon: validHorizon,
    reasoning,
    riskFactors,
  };
}

// ─── Parsing helpers ─────────────────────────────────────────────────────

function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function extractFromCodeBlock(text: string): unknown | null {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (match) {
    return tryParseJSON(match[1]);
  }
  return null;
}

function extractJSONArray(text: string): unknown | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return tryParseJSON(text.slice(start, end + 1));
}

// ─── Utility helpers ─────────────────────────────────────────────────────

/** Indent every line of a multi-line string by `spaces` (for nested context blocks). */
function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join("\n");
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

function formatVolume(vol: number): string {
  if (vol >= 1e7) return `${(vol / 1e7).toFixed(1)}Cr`;
  if (vol >= 1e5) return `${(vol / 1e5).toFixed(1)}L`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return String(vol);
}

function formatMarketCap(mc: number): string {
  // TradingView returns market cap in ₹ (not in Cr/Lakh units)
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(2)}L Cr`;
  if (mc >= 1e11) return `${(mc / 1e11).toFixed(2)}L Cr`;
  if (mc >= 1e9) return `${(mc / 1e7).toFixed(1)}Cr`;
  if (mc >= 1e7) return `${(mc / 1e7).toFixed(1)}Cr`;
  return String(mc);
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Price-based default recommendation used when AI analysis is unavailable
 * (unconfigured provider, circuit breaker open, parse failure, or per-stock error).
 * Target/SL are derived from the stock price so the Performance tab and trackers
 * never display ₹0.00 — matching the service-level fallback multipliers.
 */
function getDefaultRecommendation(stock?: Pick<StockAnalysisInput, "price">): AIRecommendation {
  const price = stock?.price ?? 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    recommendation: "HOLD",
    confidence: 50,
    targetPrice: price > 0 ? round(price * DEFAULT_TARGET_MULTIPLIER) : 0,
    stopLoss: price > 0 ? round(price * DEFAULT_STOP_LOSS_MULTIPLIER) : 0,
    timeHorizon: "medium",
    reasoning: "AI analysis unavailable — defaulting to HOLD",
    riskFactors: ["Analysis failed"],
  };
}

function failedResult(stock: StockAnalysisInput, error: string): StockAnalysisResult {
  return {
    ...stock,
    aiRecommendation: getDefaultRecommendation(stock),
    tokensUsed: 0,
    executionMs: 0,
    success: false,
    error,
  };
}
