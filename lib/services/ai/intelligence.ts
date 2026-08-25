// lib/services/ai/intelligence.ts — Orchestrator for AI Investment Intelligence
// Coordinates: cache check → parallel adapter fetch → build prompt → AI call → parse → cache store → audit

import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { directPrompt, isQuotaExhausted } from "./llm-provider";
import { getDefaultConfig } from "./config";
import { modelFallbackChain } from "./modelChain";
import { buildIntelligencePrompt, parseIntelligenceResponse } from "./intelligence-prompt";
import {
  fetchQuoteData,
  fetchTechnicalsData,
  fetchValuationData,
  fetchFundamentalsData,
  fetchShareholdingData,
  fetchCorporateData,
  fetchNewsData,
  fetchPeersData,
} from "../intelligence/adapters";
import {
  getIntelligenceFromCache,
  setIntelligenceCache,
} from "../intelligence/cache";
import type {
  IntelligenceInput,
  IntelligenceReport,
  IntelligenceAnalysis,
} from "../intelligenceTypes";
import { QUOTA_EXHAUSTED_MESSAGE } from "./llm-provider";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntelligenceOptions {
  force?: boolean;
  userId?: number;
}

export interface IntelligenceResult {
  report: IntelligenceReport | null;
  status: "cached" | "generated" | "quota_exhausted" | "failed";
  error?: string;
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Get investment intelligence for a symbol.
 * Cache-first, parallel adapter fetch, AI analysis, cache store.
 */
export async function getInvestmentIntelligence(
  symbol: string,
  options: IntelligenceOptions = {}
): Promise<IntelligenceResult> {
  const { force = false, userId } = options;
  const upperSymbol = symbol.toUpperCase();

  // 1. Cache check (skip if force refresh)
  if (!force) {
    const cached = await getIntelligenceFromCache(upperSymbol);
    if (cached) {
      await auditLog("INTELLIGENCE_CACHE_HIT", upperSymbol, userId, { modelUsed: cached.modelUsed });
      return {
        report: {
          symbol: upperSymbol,
          analysis: cached.report.analysis,
          dataUsed: cached.report.dataUsed,
          modelUsed: cached.modelUsed,
          generatedAt: cached.generatedAt.toISOString(),
          version: cached.report.version,
          isCacheHit: true,
        },
        status: "cached",
      };
    }
  }

  // 2. Parallel adapter fetch (all return null on failure)
  const [quote, technicals, valuation, fundamentals, shareholding, corporate, news, peers] =
    await Promise.allSettled([
      fetchQuoteData(upperSymbol),
      fetchTechnicalsData(upperSymbol),
      fetchValuationData(upperSymbol),
      fetchFundamentalsData(upperSymbol),
      fetchShareholdingData(upperSymbol),
      fetchCorporateData(upperSymbol),
      fetchNewsData(upperSymbol),
      fetchPeersData(upperSymbol),
    ]);

  const input: IntelligenceInput = {
    quote: settleValue(quote),
    technicals: settleValue(technicals),
    valuation: settleValue(valuation),
    fundamentals: settleValue(fundamentals),
    shareholding: settleValue(shareholding),
    corporate: settleValue(corporate),
    news: settleValue(news),
    peers: settleValue(peers),
    symbol: upperSymbol,
  };

  // Check if all adapters failed
  const hasData = input.quote || input.technicals || input.valuation || input.fundamentals || input.corporate;
  if (!hasData) {
    await auditLog("INTELLIGENCE_FAILED", upperSymbol, userId, { error: "All adapters returned null" });
    return { report: null, status: "failed", error: "No data available for this symbol" };
  }

  // 3. Build prompt
  const prompt = buildIntelligencePrompt(input);

  // 4. AI call with model fallback
  let aiResponse: string | null = null;
  let modelUsed: string | null = null;

  const models = modelFallbackChain();

  for (const model of models) {
    try {
      const modelConfig = { ...getDefaultConfig(), model };
      const response = await directPrompt(prompt, modelConfig);
      if (isQuotaExhausted(response)) {
        logger.warn({ msg: "Intelligence AI quota exhausted", model });
        continue; // try next model
      }
      if (response && !response.startsWith("AI is not configured")) {
        aiResponse = response;
        modelUsed = model;
        break;
      }
    } catch (err) {
      logger.warn({ msg: "Intelligence AI call failed", model, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!aiResponse) {
    await auditLog("INTELLIGENCE_FAILED", upperSymbol, userId, { error: "All AI models failed" });
    return { report: null, status: "quota_exhausted", error: QUOTA_EXHAUSTED_MESSAGE };
  }

  // 5. Parse response
  let analysis = parseIntelligenceResponse(aiResponse);

  // Retry once with simplified prompt on parse failure
  if (!analysis) {
    logger.warn({ msg: "Intelligence parse failed, retrying with simplified prompt", symbol: upperSymbol });
    try {
      const simplifiedPrompt = `Analyze ${upperSymbol} and return ONLY a JSON object with fields: verdict (BUY/HOLD/SELL), confidence (0-100), summary (string). No markdown.`;
      const retryResponse = await directPrompt(simplifiedPrompt);
      if (retryResponse && !isQuotaExhausted(retryResponse)) {
        analysis = parseIntelligenceResponse(retryResponse);
      }
    } catch {
      // ignore retry failure
    }
  }

  if (!analysis) {
    await auditLog("INTELLIGENCE_FAILED", upperSymbol, userId, { error: "Failed to parse AI response" });
    return { report: null, status: "failed", error: "Failed to parse AI response" };
  }

  // 6. Build report
  const report: IntelligenceReport = {
    symbol: upperSymbol,
    analysis,
    dataUsed: input,
    modelUsed,
    generatedAt: new Date().toISOString(),
    version: force ? Date.now() : 1,
    isCacheHit: false,
  };

  // 7. Cache store
  await setIntelligenceCache(upperSymbol, report, modelUsed);

  // 8. Audit
  await auditLog("INTELLIGENCE_GENERATED", upperSymbol, userId, {
    modelUsed,
    verdict: analysis.verdict,
    confidence: analysis.confidence,
    partialData: !input.quote || !input.technicals,
  });

  return { report, status: "generated" };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function settleValue<T>(result: PromiseSettledResult<T | null>): T | null {
  if (result.status === "fulfilled") return result.value;
  return null;
}

async function auditLog(
  action: "INTELLIGENCE_REQUESTED" | "INTELLIGENCE_GENERATED" | "INTELLIGENCE_CACHE_HIT" | "INTELLIGENCE_FAILED" | "INTELLIGENCE_UNAUTHORIZED",
  symbol: string,
  userId?: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await createAuditLog({
      action,
      userId,
      resource: "intelligence",
      resourceId: symbol,
      metadata: { symbol, ...metadata },
    });
  } catch {
    // Non-fatal
  }
}
