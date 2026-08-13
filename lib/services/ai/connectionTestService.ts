/**
 * AI Connection Test Service (v3.7.1)
 *
 * Probes the configured OpenRouter model with a tiny prompt and, on failure,
 * tests the fallback routes (`openrouter/free`, `openrouter/auto`) so a dead
 * or misconfigured model is caught BEFORE the 10:00 IST daily recommendations
 * run (a failed model historically produced all-HOLD runs).
 *
 * Design notes:
 *  - Uses a RAW fetch to OpenRouter (NOT `directPrompt` — that helper swallows
 *    errors into strings, which a health probe must not do). We check the HTTP
 *    status and require a parseable `choices[0].message.content`.
 *  - Results are durable via `trackAiCall` (ServerLog.source="ai", action
 *    "connection_test") so they survive serverless cold starts and appear in
 *    the AI Monitoring page.
 *  - Overall failure notifies admins (in-app + best-effort Telegram).
 */
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { loadConfig, hasValidConfig, type AIConfig } from "./config";
import { trackAiCall, getPersistedAiCalls, type AiCallEntry } from "./ai-monitoring";
import { notifyAdmins } from "@/lib/services/notificationService";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Fallback routes probed in order when the configured model fails. */
export const AI_FALLBACK_MODELS = ["openrouter/free", "openrouter/auto"] as const;

/** Action tag recorded via trackAiCall for every probe attempt. */
export const CONNECTION_TEST_ACTION = "connection_test";

const TEST_PROMPT = "Reply with exactly one word: OK";
// 60s: the free-tier models (e.g. nvidia/nemotron-3-ultra-550b-a55b:free) can
// take 30-60s+ to start generating under load; 20s produced false failures.
const TEST_TIMEOUT_MS = 60_000;

export interface AiModelTestResult {
  model: string;
  ok: boolean;
  httpStatus?: number;
  responseTimeMs: number;
  error?: string;
  preview?: string;
}

export type AiConnectionTestStatus = "ok" | "fallback" | "failed";

export interface AiConnectionTestReport {
  testedAt: string;
  status: AiConnectionTestStatus;
  configuredModel: string;
  primary: AiModelTestResult;
  fallbacks: AiModelTestResult[];
  /** First model that answered OK when the primary failed (absent when ok/all failed). */
  recommendedModel?: string;
}

/**
 * Probe a single OpenRouter model with a tiny completion.
 * Never throws — always returns a structured result.
 */
export async function testOpenRouterModel(
  model: string,
  config?: AIConfig,
  timeoutMs: number = TEST_TIMEOUT_MS,
): Promise<AiModelTestResult> {
  const cfg = config ?? (await loadConfig());
  const start = Date.now();

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_BASE_URL || "https://tradenext6.app",
        "X-Title": "TradeNext AI",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: TEST_PROMPT }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseTimeMs = Date.now() - start;

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      return {
        model,
        ok: false,
        httpStatus: res.status,
        responseTimeMs,
        error: errText || `HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const ok = content.trim().length > 0;
    return {
      model,
      ok,
      httpStatus: res.status,
      responseTimeMs,
      error: ok ? undefined : "Empty model response",
      preview: content.slice(0, 120),
    };
  } catch (err) {
    return {
      model,
      ok: false,
      responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run the full connection test: configured model first, then the fallback
 * routes in order (stopping at the first working one). Every attempt is
 * tracked via trackAiCall; an overall failure notifies admins.
 *
 * @param timeoutMs Per-probe timeout (defaults to TEST_TIMEOUT_MS). The daily
 *   recommendations pre-flight passes a longer budget (120s) because the free
 *   nvidia model can take 90s+ to start generating — a 60s health-check cap
 *   would false-fail the gate.
 */
export async function runAiConnectionTest(
  timeoutMs: number = TEST_TIMEOUT_MS,
): Promise<AiConnectionTestReport> {
  const testedAt = new Date().toISOString();
  const config = await loadConfig();

  // Not configured (missing key / disabled) — surface immediately instead of
  // 401-ing every attempt. No model is probed.
  if (!hasValidConfig(config)) {
    const report: AiConnectionTestReport = {
      testedAt,
      status: "failed",
      configuredModel: config.model,
      primary: {
        model: config.model,
        ok: false,
        responseTimeMs: 0,
        error: "AI not configured (missing OPENROUTER key or disabled) — nothing to test",
      },
      fallbacks: [],
    };
    logger.warn({ msg: "AI connection test skipped: AI not configured", configuredModel: config.model });
    await notifyAdmins(
      "⚠️ AI not configured",
      `AI connection test could not run: no OpenRouter API key configured or AI disabled. The daily recommendations run will fall back to all-HOLD.`,
      "/admin/utils/ai-monitoring",
    ).catch((e) => logger.warn({ msg: "Admin notify for AI config failure failed", error: e }));
    await createAuditLog({
      action: "AI_CONNECTION_TEST_FAILED",
      resource: "ai-config",
      metadata: {
        status: "failed",
        configuredModel: config.model,
        reason: "AI not configured (missing OPENROUTER key or disabled)",
      },
      errorMessage: "AI connection test skipped: not configured",
    });
    return report;
  }

  const track = async (model: string, r: AiModelTestResult): Promise<void> => {
    await trackAiCall({
      // Per-attempt timestamp — this closure runs BEFORE `report` exists, so it
      // must never reference it (TDZ ReferenceError otherwise).
      timestamp: new Date().toISOString(),
      action: CONNECTION_TEST_ACTION,
      model,
      status: r.ok ? "success" : "error",
      tokensUsed: 0,
      responseTimeMs: r.responseTimeMs,
      error: r.ok ? undefined : r.error,
      analysisType: "recommendation",
      prompt: TEST_PROMPT,
      result: r.preview,
    });
  };

  const configuredModel = config.model;
  const primary = await testOpenRouterModel(configuredModel, config, timeoutMs);
  await track(configuredModel, primary);

  if (primary.ok) {
    logger.info({ msg: "AI connection test passed", configuredModel, responseTimeMs: primary.responseTimeMs });
    await createAuditLog({
      action: "AI_CONNECTION_TEST",
      resource: "ai-config",
      metadata: {
        status: "ok",
        configuredModel,
        responseTimeMs: primary.responseTimeMs,
        testedAt,
      },
    });
    return { testedAt, status: "ok", configuredModel, primary, fallbacks: [] };
  }

  // Primary failed — probe fallback routes in order until one answers.
  const fallbacks: AiModelTestResult[] = [];
  for (const model of AI_FALLBACK_MODELS) {
    const r = await testOpenRouterModel(model, config, timeoutMs);
    fallbacks.push(r);
    await track(model, r);
    if (r.ok) break;
  }

  const working = fallbacks.find((r) => r.ok);
  const status: AiConnectionTestStatus = working ? "fallback" : "failed";
  const report: AiConnectionTestReport = {
    testedAt,
    status,
    configuredModel,
    primary,
    fallbacks,
    ...(working ? { recommendedModel: working.model } : {}),
  };

  logger.warn({
    msg: "AI connection test did not pass on the configured model",
    status,
    configuredModel,
    primaryError: primary.error,
    fallbackResults: fallbacks.map((f) => ({ model: f.model, ok: f.ok, error: f.error })),
  });

  await createAuditLog({
    action: working ? "AI_CONNECTION_TEST" : "AI_CONNECTION_TEST_FAILED",
    resource: "ai-config",
    metadata: {
      status,
      configuredModel,
      testedAt,
      ...(working ? { recommendedModel: working.model } : {}),
      primaryError: primary.error,
      fallbackResults: fallbacks.map((f) => ({ model: f.model, ok: f.ok, error: f.error })),
    },
    errorMessage: working
      ? undefined
      : `All AI models unreachable (${configuredModel}, ${AI_FALLBACK_MODELS.join(", ")})`,
  });

  if (!working) {
    await notifyAdmins(
      "⚠️ AI model unreachable",
      `AI connection test FAILED on configured model "${configuredModel}" and both fallback routes (${AI_FALLBACK_MODELS.join(", ")}). The daily recommendations run at 10:00 AM IST will likely produce all-HOLD results.`,
      "/admin/utils/ai-monitoring",
    ).catch((e) => logger.warn({ msg: "Admin notify for AI failure failed", error: e }));
  }

  return report;
}

/**
 * Last connection-test records, read from DB-persisted AI call entries
 * (ServerLog.source="ai", action="connection_test"). Survives serverless.
 */
export async function getLastAiConnectionTests(limit = 10): Promise<AiCallEntry[]> {
  try {
    const calls = await getPersistedAiCalls(Math.max(limit * 4, 50));
    return calls.filter((c) => c.action === CONNECTION_TEST_ACTION).slice(0, limit);
  } catch (err) {
    logger.warn({ msg: "getLastAiConnectionTests failed", error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
