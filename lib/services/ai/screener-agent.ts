/**
 * Stock screener agent using @openrouter/agent SDK.
 * Uses callModel() with NSE tool calling for stock analysis.
 */
import { tool, stepCountIs } from "@openrouter/agent";
import { z } from "zod";
import { getClient } from "./llm-provider";
import { SCREENER_SYSTEM_PROMPT, getScreenerUserPrompt } from "./prompts";
import type { AIConfig } from "./config";
import logger from "@/lib/logger";

// ─── Helper: fetch internal API ──────────────────────────────────────────

const BASE = process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

async function fetchJSON(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
  return JSON.stringify(await res.json(), null, 2);
}

// ─── NSE Tools ───────────────────────────────────────────────────────────

/**
 * Get a real-time stock quote for a given NSE symbol.
 */
const stockQuoteTool = tool({
  name: "get_stock_quote",
  description: "Get real-time stock quote for a given NSE symbol, including current price, change, volume, and day range",
  inputSchema: z.object({
    symbol: z.string().describe("NSE stock symbol (e.g., RELIANCE, TCS, INFY, HDFCBANK)"),
  }),
  execute: async ({ symbol }) => {
    logger.info({ msg: "Agent tool: get_stock_quote", symbol });
    try {
      return await fetchJSON(`/api/nse/stock?symbol=${encodeURIComponent(symbol)}`);
    } catch (err) {
      logger.error({ msg: "get_stock_quote tool failed", symbol, error: err });
      return `Error fetching data for ${symbol}`;
    }
  },
});

/**
 * Get today's top gaining stocks on NSE.
 */
const gainersTool = tool({
  name: "get_top_gainers",
  description: "Get today's top gaining stocks on NSE with price, change %, and volume",
  inputSchema: z.object({}),
  execute: async () => {
    logger.info({ msg: "Agent tool: get_top_gainers" });
    try {
      return await fetchJSON("/api/nse/gainers");
    } catch (err) {
      logger.error({ msg: "get_top_gainers tool failed", error: err });
      return "Error fetching gainers";
    }
  },
});

/**
 * Get today's top losing stocks on NSE.
 */
const losersTool = tool({
  name: "get_top_losers",
  description: "Get today's top losing stocks on NSE with price, change %, and volume",
  inputSchema: z.object({}),
  execute: async () => {
    logger.info({ msg: "Agent tool: get_top_losers" });
    try {
      return await fetchJSON("/api/nse/losers");
    } catch (err) {
      logger.error({ msg: "get_top_losers tool failed", error: err });
      return "Error fetching losers";
    }
  },
});

/**
 * Get current NSE market indices (NIFTY 50, BANK NIFTY, etc.).
 */
const indicesTool = tool({
  name: "get_market_indices",
  description: "Get current NSE market indices data including NIFTY 50, BANK NIFTY, NIFTY IT, NIFTY MIDCAP, etc.",
  inputSchema: z.object({}),
  execute: async () => {
    logger.info({ msg: "Agent tool: get_market_indices" });
    try {
      const res = await fetch(`${BASE}/api/nse/indexes`);
      if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (err) {
      logger.error({ msg: "get_market_indices tool failed", error: err });
      return "Error fetching indices";
    }
  },
});

// All tools as a const array for full type inference
const screenerTools = [stockQuoteTool, gainersTool, losersTool, indicesTool] as const;

// ─── Types ───────────────────────────────────────────────────────────────

export interface ScreenerAgentResult {
  success: boolean;
  analysis: string;
  executionTimeMs: number;
  model: string;
  toolCalls?: number;
  tokensUsed?: number;
}

// ─── Execute ─────────────────────────────────────────────────────────────

/**
 * Run the screener agent with a natural language query.
 *
 * Uses the Agent SDK's callModel() with automatic tool execution:
 * 1. Sends the user query + system prompt
 * 2. Model may call NSE tools (stock quote, gainers, losers, indices)
 * 3. SDK auto-executes tools and feeds results back
 * 4. Loops until model produces final answer or max steps reached
 * 5. Returns the final analysis text
 */
export async function runScreenerAgent(
  query: string,
  config?: AIConfig
): Promise<ScreenerAgentResult> {
  const startTime = Date.now();
  const client = getClient(config);
  const model = config?.model || "openrouter/free";

  try {
    const userPrompt = getScreenerUserPrompt(query);
    const fullPrompt = `${SCREENER_SYSTEM_PROMPT}\n\n${userPrompt}`;

    const result = await client.callModel({
      model,
      input: fullPrompt,
      tools: screenerTools,
      stopWhen: stepCountIs(5), // Max 5 tool execution rounds
    });

    const analysis = await result.getText();

    // Try to get response metadata (may not be available on all models)
    let tokensUsed: number | undefined;
    try {
      const response = await result.getResponse();
      const usage = response.usage;
      tokensUsed = usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    } catch {
      // Response metadata not available — skip
    }

    return {
      success: true,
      analysis: analysis || "No analysis generated.",
      executionTimeMs: Date.now() - startTime,
      model,
      toolCalls: undefined, // Agent SDK auto-executes tools internally
      tokensUsed,
    };
  } catch (err) {
    logger.error({ msg: "Screener agent failed", query, model, error: err });
    return {
      success: false,
      analysis: `AI analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      executionTimeMs: Date.now() - startTime,
      model,
    };
  }
}
