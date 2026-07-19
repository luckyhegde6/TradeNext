/**
 * OpenRouter LLM Provider using @openrouter/agent SDK.
 *
 * Two modes:
 * 1. `callModel()` — Multi-turn agent with tools, auto-execution, stop conditions
 * 2. `directPrompt()` — Simple Q&A (no tools, single turn)
 *
 * Both use the agent SDK's OpenRouter client under the hood.
 */
import { OpenRouter } from "@openrouter/agent";
import { getDefaultConfig, type AIConfig } from "./config";
import logger from "@/lib/logger";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

let cachedClient: OpenRouter | null = null;
let cachedConfigHash = "";

function configHash(cfg: AIConfig): string {
  return `${cfg.model}|${cfg.temperature}|${cfg.maxTokens}|${cfg.apiKey.slice(0, 8)}`;
}

/**
 * Get or create a cached OpenRouter Agent SDK client.
 * Re-creates if config changes.
 */
export function getClient(config?: AIConfig): OpenRouter {
  const cfg = config || getDefaultConfig();
  const hash = configHash(cfg);

  if (cachedClient && cachedConfigHash === hash) {
    return cachedClient;
  }

  if (!cfg.apiKey) {
    logger.warn({ msg: "No OpenRouter API key configured. AI features will be disabled." });
  }

  cachedClient = new OpenRouter({
    apiKey: cfg.apiKey,
  });

  cachedConfigHash = hash;
  return cachedClient;
}

/**
 * Reset the cached client instance (e.g., when config changes).
 */
export function resetClient(): void {
  cachedClient = null;
  cachedConfigHash = "";
}

/**
 * Alias for backward compatibility.
 * @deprecated Use getClient() instead.
 */
export const getLLM = getClient;
/** @deprecated Use resetClient() instead. */
export const resetLLM = resetClient;

/**
 * Simple direct fetch to OpenRouter (bypasses Agent SDK for quick calls).
 * Useful for simple completions without tool calling or agent setup.
 */
export async function directPrompt(
  prompt: string,
  config?: AIConfig
): Promise<string> {
  const cfg = config || getDefaultConfig();

  if (!cfg.apiKey) {
    return "AI is not configured. Please set OPENROUTERKEY in your .env file.";
  }

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_BASE_URL || "https://tradenext6.app",
        "X-Title": "TradeNext AI",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: prompt }],
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ msg: "OpenRouter API error", status: response.status, error: errText });
      return `AI request failed (HTTP ${response.status}). Please check your OpenRouter API key.`;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "No response from AI.";
  } catch (err) {
    logger.error({ msg: "OpenRouter fetch failed", error: err });
    return "AI request failed. Please try again later.";
  }
}
