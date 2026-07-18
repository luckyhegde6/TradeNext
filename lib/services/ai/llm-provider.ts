/**
 * OpenRouter LLM Provider using LangChain.
 * OpenRouter exposes an OpenAI-compatible API, so we use ChatOpenAI with a custom base URL.
 */
import { ChatOpenAI } from "@langchain/openai";
import { getDefaultConfig, type AIConfig } from "./config";
import logger from "@/lib/logger";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

let cachedModel: ChatOpenAI | null = null;
let cachedConfigHash = "";

function configHash(cfg: AIConfig): string {
  return `${cfg.model}|${cfg.temperature}|${cfg.maxTokens}|${cfg.apiKey.slice(0, 8)}`;
}

/**
 * Get or create a cached ChatOpenAI instance configured for OpenRouter.
 * Re-creates if config changes.
 */
export function getLLM(config?: AIConfig): ChatOpenAI {
  const cfg = config || getDefaultConfig();
  const hash = configHash(cfg);

  if (cachedModel && cachedConfigHash === hash) {
    return cachedModel;
  }

  if (!cfg.apiKey) {
    logger.warn({ msg: "No OpenRouter API key configured. AI features will be disabled." });
  }

  let modelName = cfg.model;
  // Map openrouter/xxx to the actual model ID for the API
  if (modelName.startsWith("openrouter/")) {
    modelName = modelName.replace("openrouter/", "");
    // Default to a well-known free model if just "openrouter/free"
    if (modelName === "free") {
      modelName = "openai/gpt-4o-mini";
    }
  }

  cachedModel = new ChatOpenAI({
    modelName,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    openAIApiKey: cfg.apiKey,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_BASE_URL || "https://tradenext6.app",
        "X-Title": "TradeNext AI",
      },
    },
  });

  cachedConfigHash = hash;
  return cachedModel;
}

/**
 * Reset the cached LLM instance (e.g., when config changes).
 */
export function resetLLM(): void {
  cachedModel = null;
  cachedConfigHash = "";
}

/**
 * Simple direct fetch to OpenRouter (bypasses LangChain for quick calls).
 * Useful for simple completions without tool calling.
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
        model: cfg.model === "openrouter/free" ? "openai/gpt-4o-mini" : cfg.model,
        messages: [{ role: "user", content: prompt }],
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      }),
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
