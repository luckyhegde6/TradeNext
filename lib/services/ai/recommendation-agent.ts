/**
 * Daily Recommendation Agent — Analyzes stocks flagged by screeners
 * and generates BUY/HOLD/SELL recommendations with AI reasoning.
 *
 * Uses directPrompt() (no tool calling needed — stock data is pre-fetched).
 * Processes in batches of 5 to stay within token limits.
 */
import { directPrompt } from "./llm-provider";
import { hasValidConfig, type AIConfig } from "./config";
import { trackAiCall } from "./ai-monitoring";
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
 */
export async function analyzeStocks(
  stocks: StockAnalysisInput[],
  config?: AIConfig
): Promise<StockAnalysisResult[]> {
  if (!hasValidConfig(config)) {
    logger.warn({ msg: "AI not configured, skipping recommendation analysis" });
    return stocks.map((s) => failedResult(s, "AI is not configured"));
  }

  const results: StockAnalysisResult[] = [];
  const totalBatches = Math.ceil(stocks.length / BATCH_SIZE);

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE);
    const batch = stocks.slice(i, i + BATCH_SIZE);

    logger.info({
      msg: "Analyzing batch",
      batchIndex: batchIndex + 1,
      of: totalBatches,
      symbols: batch.map((s) => s.symbol),
    });

    try {
      const batchResults = await analyzeBatch(batch, config);
      results.push(...batchResults);
    } catch (e) {
      logger.warn({
        msg: "Batch analysis failed",
        batchIndex: batchIndex + 1,
        error: e instanceof Error ? e.message : String(e),
      });
      for (const stock of batch) {
        results.push(failedResult(stock, e instanceof Error ? e.message : String(e)));
      }
    }
  }

  logger.info({
    msg: "Stock analysis complete",
    total: stocks.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
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
 * Analyze a single batch of up to 5 stocks with retry.
 */
async function analyzeBatch(
  stocks: StockAnalysisInput[],
  config?: AIConfig
): Promise<StockAnalysisResult[]> {
  const prompt = buildAnalysisPrompt(stocks);
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      const batchStart = Date.now();
      const response = await directPrompt(prompt, config);
      const batchMs = Date.now() - batchStart;

      const recommendations = parseAIResponse(response, stocks);

      const batchResults = stocks.map((stock, idx) => {
        const rec = recommendations[idx];
        if (!rec) {
          return failedResult(stock, "No recommendation returned for this stock");
        }
        return {
          ...stock,
          aiRecommendation: rec,
          tokensUsed: estimateTokens(prompt) + estimateTokens(response),
          executionMs: batchMs,
          success: true,
        };
      });

      // Track AI call for monitoring
      trackAiCall({
        timestamp: new Date().toISOString(),
        action: "recommendation_batch",
        model: config?.model || "unknown",
        status: "success",
        tokensUsed: batchResults.reduce((sum, r) => sum + r.tokensUsed, 0),
        responseTimeMs: batchMs,
        analysisType: "recommendation",
        prompt: prompt.slice(0, 500),
        result: response.slice(0, 1000),
      });

      return batchResults;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      logger.warn({
        msg: "Batch attempt failed",
        attempt,
        of: RETRY_MAX,
        error: lastError,
      });

      if (attempt < RETRY_MAX) {
        const delay = Math.min(
          RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
          MAX_RETRY_DELAY_MS
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — track failure
  trackAiCall({
    timestamp: new Date().toISOString(),
    action: "recommendation_batch",
    model: config?.model || "unknown",
    status: "error",
    tokensUsed: 0,
    responseTimeMs: 0,
    analysisType: "recommendation",
    error: lastError || "unknown",
    prompt: prompt.slice(0, 500),
  });

  throw new Error(`Batch failed after ${RETRY_MAX} attempts: ${lastError || "unknown"}`);
}

/**
 * Build the analysis prompt for a batch of stocks.
 */
function buildAnalysisPrompt(stocks: StockAnalysisInput[]): string {
  const stockLines = stocks
    .map(
      (s, i) =>
        `${i + 1}. ${s.symbol} — Price: ₹${s.price}, Change: ${s.change >= 0 ? "+" : ""}${s.change} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent}%), Volume: ${formatVolume(s.volume)}, Screeners: ${s.screenerNames.join(", ")}`
    )
    .join("\n");

  return `${SYSTEM_PROMPT}

Analyze these NSE stocks and return a JSON array with one recommendation per stock:

${stockLines}

${RESPONSE_SCHEMA_HINT}

IMPORTANT: Return ONLY the JSON array. No markdown, no explanation.`;
}

/**
 * Parse the AI response into structured recommendations.
 * Handles: raw JSON, markdown code blocks, partial text wrapping.
 */
function parseAIResponse(response: string, stocks: StockAnalysisInput[]): AIRecommendation[] {
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
    return stocks.map(() => getDefaultRecommendation());
  }

  // Map parsed objects to our schema, matching by index
  return stocks.map((stock, idx) => {
    const raw = findRecommendationBySymbol(parsed, stock.symbol) || parsed[idx];

    if (!raw) {
      logger.warn({ msg: "No recommendation found for stock", symbol: stock.symbol });
      return getDefaultRecommendation();
    }

    return normalizeRecommendation(raw, stock);
  });
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
  const targetPrice = toNumber(raw.targetPrice) || stock.price;
  const stopLoss = toNumber(raw.stopLoss) || 0;

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

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDefaultRecommendation(): AIRecommendation {
  return {
    recommendation: "HOLD",
    confidence: 50,
    targetPrice: 0,
    stopLoss: 0,
    timeHorizon: "medium",
    reasoning: "AI analysis unavailable — defaulting to HOLD",
    riskFactors: ["Analysis failed"],
  };
}

function failedResult(stock: StockAnalysisInput, error: string): StockAnalysisResult {
  return {
    ...stock,
    aiRecommendation: getDefaultRecommendation(),
    tokensUsed: 0,
    executionMs: 0,
    success: false,
    error,
  };
}
