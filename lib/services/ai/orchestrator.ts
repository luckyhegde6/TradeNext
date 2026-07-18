/**
 * AI Orchestrator — Central coordinator for all AI operations.
 *
 * Integrates:
 * - Safety checks (prompt injection detection, input sanitization)
 * - Rate limiting (per-user/IP with sliding window, token-based)
 * - Context management (conversation history, token budgeting)
 * - Result storage (persist all analyses, correlation engine)
 * - LLM provider (OpenRouter Agent SDK callModel)
 * - Error handling (retry with backoff, graceful degradation)
 * - Audit logging
 */
import { getDefaultConfig, hasValidConfig, type AIConfig } from "./config";
import { getClient, directPrompt, resetClient } from "./llm-provider";
import { checkPromptSafety, filterAIResponse, estimateTokenCount, type SafetyCheckResult } from "./safety";
import { checkRateLimit, recordViolation, getRateLimitHeaders, type RateLimitResult } from "./rateLimit";
import {
  createConversation,
  addMessage,
  getUserConversations,
  closeConversation,
  type ConversationContext,
  type ContextMessage,
} from "./context";
import {
  storeResult,
  findCorrelations,
  getAggregateStats,
  getResults,
  type AnalysisType,
  type StoredResultInput,
} from "./results";
import { SCREENER_SYSTEM_PROMPT } from "./prompts";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  userId: number;
  ipAddress: string;
  analysisType: AnalysisType;
  query: string;
  conversationId?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, any>;
  useTools?: boolean;
}

export interface OrchestratorResult {
  success: boolean;
  data?: {
    analysis: string;
    filteredAnalysis: string;
    analysisId: string;
    conversationId: string | null;
    tokensUsed: number;
    executionTime: number;
    model: string;
    safety: SafetyCheckResult;
    rateLimit: RateLimitResult;
    correlations?: any;
  };
  error?: {
    message: string;
    code: "SAFETY" | "RATE_LIMIT" | "AUTH" | "CONFIG" | "PROVIDER" | "INTERNAL";
    retryable: boolean;
  };
  headers: Record<string, string>;
}

// ─── Retry config ────────────────────────────────────────────────────────

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1s
  maxDelay: 10000, // 10s
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main orchestrator ───────────────────────────────────────────────────

/**
 * Execute an AI operation with full safety, rate limiting, context, and storage.
 */
export async function executeAIQuery(input: OrchestratorInput): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const { userId, ipAddress, analysisType, query, metadata } = input;

  // Default headers
  const headers: Record<string, string> = {};

  try {
    // 1. Configuration check
    const config = getDefaultConfig();
    if (!hasValidConfig(config)) {
      return {
        success: false,
        error: {
          message: "AI is not configured. Admin must set OPENROUTERKEY.",
          code: "CONFIG",
          retryable: false,
        },
        headers: { "X-AI-Status": "not-configured" },
      };
    }

    // 2. Safety check — prompt injection detection
    const safetyResult = checkPromptSafety(query);
    headers["X-AI-Safety"] = safetyResult.safe ? "passed" : "blocked";
    headers["X-AI-RiskScore"] = String(safetyResult.riskScore);

    if (!safetyResult.safe) {
      await recordViolation(userId, ipAddress);
      return {
        success: false,
        error: {
          message: "Input was flagged for safety concerns. Please rephrase your query.",
          code: "SAFETY",
          retryable: false,
        },
        headers,
      };
    }

    // 3. Rate limit check
    const estimatedTokens = estimateTokenCount(safetyResult.sanitized);
    const rateResult = await checkRateLimit(userId, ipAddress, estimatedTokens);
    Object.assign(headers, getRateLimitHeaders(rateResult));

    if (!rateResult.allowed) {
      return {
        success: false,
        error: {
          message: rateResult.reason || "Rate limit exceeded. Please wait before trying again.",
          code: "RATE_LIMIT",
          retryable: true,
        },
        headers,
      };
    }

    // 4. Context management
    let conversation: ConversationContext | null = null;

    if (input.conversationId) {
      // Continue existing conversation
      const existing = await getUserConversations(userId);
      conversation = existing.find((c) => c.id === input.conversationId) || null;
      if (conversation) {
        conversation = await addMessage(
          conversation.id,
          userId,
          "user",
          safetyResult.sanitized,
          input.model || config.model
        );
      }
    }

    if (!conversation) {
      // Create new conversation
      conversation = await createConversation(
        userId,
        analysisType,
        `Analysis: ${safetyResult.sanitized.slice(0, 80)}${safetyResult.sanitized.length > 80 ? "..." : ""}`
      );
      await addMessage(
        conversation.id,
        userId,
        "user",
        safetyResult.sanitized,
        input.model || config.model
      );
    }

    // 5. Execute AI query with retry
    let aiResult: string;
    let aiSuccess = true;
    let aiErrorMsg: string | undefined;
    let lastError: Error | null = null;

    const activeConfig: AIConfig = {
      ...config,
      ...(input.model && { model: input.model }),
      ...(input.temperature && { temperature: input.temperature }),
      ...(input.maxTokens && { maxTokens: input.maxTokens }),
    };

    const systemPrompt = input.systemPrompt || SCREENER_SYSTEM_PROMPT;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        if (input.useTools) {
          // Use Agent SDK callModel with tools (for screener)
          const client = getClient(activeConfig);
          const result = await client.callModel({
            model: activeConfig.model,
            input: [{ role: "user", content: `${systemPrompt}\n\n${safetyResult.sanitized}` }],
          });
          aiResult = await result.getText();
        } else {
          // Direct prompt (simpler queries, dividend/market/alert analysis)
          const fullPrompt = `${systemPrompt}\n\nUser Query: ${safetyResult.sanitized}\n\nProvide a detailed, well-structured analysis.`;
          aiResult = await directPrompt(fullPrompt, activeConfig);
        }

        lastError = null;

        // 6. Filter the response
        const filteredAnalysis = filterAIResponse(aiResult);

        // 7. Store the result
        const storedResult = await storeResult({
          userId,
          analysisType,
          query: safetyResult.sanitized,
          result: aiResult,
          model: activeConfig.model,
          tokensUsed: estimatedTokens + estimateTokenCount(aiResult),
          executionTime: Date.now() - startTime,
          success: true,
          conversationId: conversation.id,
          metadata: {
            ...metadata,
            safetyFlags: safetyResult.flags,
            riskScore: safetyResult.riskScore,
            attempt,
          },
        });

        // 8. Save assistant response to conversation
        await addMessage(
          conversation.id,
          userId,
          "assistant",
          aiResult,
          activeConfig.model
        );

        // 9. Find correlations (async, non-blocking)
        const correlations = await findCorrelations(userId, {
          analysisType,
          daysBack: 30,
          limit: 50,
        }).catch(() => null);

        return {
          success: true,
          data: {
            analysis: aiResult,
            filteredAnalysis,
            analysisId: storedResult.id,
            conversationId: conversation.id,
            tokensUsed: estimatedTokens + estimateTokenCount(aiResult),
            executionTime: Date.now() - startTime,
            model: activeConfig.model,
            safety: safetyResult,
            rateLimit: rateResult,
            correlations: correlations?.correlations.slice(0, 5) || [],
          },
          headers: {
            ...headers,
            "X-AI-AnalysisId": storedResult.id,
            "X-AI-Model": activeConfig.model,
            "X-AI-Tokens": String(estimatedTokens),
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        aiSuccess = false;
        aiErrorMsg = lastError.message;

        if (attempt < RETRY_CONFIG.maxRetries) {
          const delay = Math.min(RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1), RETRY_CONFIG.maxDelay);
          logger.warn({
            msg: `AI query retry ${attempt}/${RETRY_CONFIG.maxRetries}`,
            error: lastError.message,
            delay,
          });
          await sleep(delay);
        }
      }
    }

    // All retries failed — store error result
    const errorResult = await storeResult({
      userId,
      analysisType,
      query: safetyResult.sanitized,
      result: "",
      model: activeConfig.model,
      tokensUsed: estimatedTokens,
      executionTime: Date.now() - startTime,
      success: false,
      errorMessage: lastError?.message,
      conversationId: conversation.id,
      metadata: { ...metadata, error: lastError?.message },
    });

    return {
      success: false,
      error: {
        message: `AI analysis failed after ${RETRY_CONFIG.maxRetries} attempts: ${lastError?.message || "Unknown error"}`,
        code: "PROVIDER",
        retryable: false,
      },
      headers: {
        ...headers,
        "X-AI-Error": lastError?.message?.slice(0, 100) || "unknown",
      },
    };
  } catch (err) {
    logger.error({ msg: "AI orchestrator critical error", userId, analysisType, error: err });
    return {
      success: false,
      error: {
        message: "An unexpected error occurred. Please try again.",
        code: "INTERNAL",
        retryable: false,
      },
      headers,
    };
  }
}

// ─── Convenience wrappers ────────────────────────────────────────────────

/**
 * Get aggregate AI stats for a user (for dashboard widgets).
 */
export async function getAIDashboard(userId: number) {
  const [stats, recentResults] = await Promise.all([
    getAggregateStats(userId),
    getResults(userId, { limit: 5 }),
  ]);
  return { stats, recentResults: recentResults.results };
}

/**
 * Get AI correlations for a specific symbol.
 */
export async function getSymbolCorrelations(userId: number, symbol: string) {
  return findCorrelations(userId, { symbol: symbol.toUpperCase(), daysBack: 90, limit: 100 });
}
