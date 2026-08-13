/**
 * AI Agent configuration.
 * Model selection and provider settings, configurable by admin.
 *
 * Models are FREE on OpenRouter. Prefer WEEKLY free models (higher quotas)
 * over daily free models (which hit rate limits quickly).
 * See: https://openrouter.ai/models?order=pricing-low-to-high
 */
import logger from "@/lib/logger";

/**
 * Default model — validated against the live OpenRouter `/models` catalog.
 *
 * IMPORTANT (2026-08-11): `tencent/hy3:free` and `qwen/qwen3-next-80b-a3b-instruct:free`
 * DO NOT exist on OpenRouter and return HTTP 404. Pick a default from the catalog
 * below; run `curl https://openrouter.ai/api/v1/models` to re-validate.
 */
export const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

export interface ModelInfo {
  id: string;
  name: string;
  /** Short description of the model's strengths */
  description?: string;
  /** Estimated context window in tokens */
  contextLength?: number;
  /** Billing period: "weekly" = weekly free quota, "daily" = daily free quota, "auto" = OpenRouter auto-route */
  billingPeriod?: "weekly" | "daily" | "auto";
}

/**
 * Available free models on OpenRouter.
 *
 * Selection criteria:
 * - pricing.prompt = $0, pricing.completion = $0
 * - supports "tools" and "tool_choice" parameters
 * - no imminent expiration date
 * - diverse range of capabilities
 * - CONFIRMED present in the live OpenRouter `/models` catalog (verified 2026-08-11).
 *   Removed `tencent/hy3:free` and `qwen/qwen3-next-80b-a3b-instruct:free` (404).
 */
export const AVAILABLE_MODELS: ModelInfo[] = [
  // ── Daily Free Models (best quality first) ─────────────────────────────
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra 550B (Daily)",
    description: "Highest quality free model, 1M context, best benchmarks",
    contextLength: 1_000_000,
    billingPeriod: "daily",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron 3 Super 120B (Daily)",
    description: "Strong reasoning, 1M context, structured outputs",
    contextLength: 1_000_000,
    billingPeriod: "daily",
  },
  {
    id: "openai/gpt-oss-20b:free",
    name: "GPT-OSS 20B (Daily)",
    description: "OpenAI's open-source model, reasoning + tools",
    contextLength: 131_072,
    billingPeriod: "daily",
  },
  {
    id: "google/gemma-4-31b-it:free",
    name: "Gemma 4 31B (Daily)",
    description: "Google's latest open model, 262K context",
    contextLength: 262_144,
    billingPeriod: "daily",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    name: "Gemma 4 26B A4B (Daily)",
    description: "Google MoE open model, multimodal, 262K context",
    contextLength: 262_144,
    billingPeriod: "daily",
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    name: "Nemotron 3 Nano 30B (Daily)",
    description: "Fast and efficient, 256K context",
    contextLength: 256_000,
    billingPeriod: "daily",
  },
  {
    id: "inclusionai/ling-3.0-tiny:free",
    name: "Ling 3.0 Tiny (Daily)",
    description: "Small MoE, 262K context, structured outputs",
    contextLength: 262_144,
    billingPeriod: "daily",
  },
  {
    id: "cohere/north-mini-code:free",
    name: "Cohere North Mini Code (Daily)",
    description: "Cohere agentic coding model, 256K context",
    contextLength: 256_000,
    billingPeriod: "daily",
  },
  // ── Auto Router ───────────────────────────────────────────────────────
  {
    id: "openrouter/free",
    name: "OpenRouter Free (Auto-Router)",
    description: "Routes to random free model. Unreliable quotas.",
    contextLength: 200_000,
    billingPeriod: "auto",
  },
];

// Backward-compatible alias for existing references
/** @deprecated Use the `id` field from `AVAILABLE_MODELS` instead */
export const FALLBACK_MODEL = DEFAULT_MODEL;

export interface AIConfig {
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

/**
 * Get AI configuration from environment + admin overrides.
 * Priority: .env defaults > hardcoded defaults.
 * NOTE: This is synchronous/env-only — use `loadConfig()` for the full
 * DB-aware resolution (admin model/temperature/maxTokens/enabled overrides).
 */
export function getDefaultConfig(): AIConfig {
  return {
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    apiKey: process.env.OPENROUTERKEY || process.env.OPENROUTER_API_KEY || "",
    temperature: 0.3,
    // 8192 output tokens: a 5-stock analysis batch + JSON reasoning easily
    // exceeds 2048 (observed truncated JSON → HOLD defaults). The nvidia
    // default model has a 1M context window, so this is safe.
    maxTokens: 8192,
    enabled: true,
  };
}

/**
 * Load the effective AI config: DB `ai_config` Secret overrides merged onto
 * the env defaults. This is the single source of truth for pipelines that
 * must honor the admin model selection (e.g., daily recommendations).
 *
 * Priority: Admin DB config > .env defaults > hardcoded defaults.
 * Falls back to env config when the DB is unavailable or nothing is stored.
 */
export async function loadConfig(): Promise<AIConfig> {
  const envConfig = getDefaultConfig();
  try {
    // Lazy import keeps this module Prisma-free at top level (client-safe).
    const { default: prisma } = await import("@/lib/prisma");
    const stored = await prisma.secret.findFirst({ where: { name: "ai_config" } });
    if (stored?.metadata && typeof stored.metadata === "object") {
      const db = stored.metadata as Record<string, unknown>;
      return {
        ...envConfig,
        model: (db.model as string) || envConfig.model,
        temperature: (db.temperature as number) ?? envConfig.temperature,
        maxTokens: (db.maxTokens as number) ?? envConfig.maxTokens,
        enabled: (db.enabled as boolean) ?? envConfig.enabled,
      };
    }
  } catch (err) {
    logger.warn({ msg: "loadConfig: DB unavailable, using env defaults", error: err instanceof Error ? err.message : String(err) });
  }
  return envConfig;
}

/**
 * Validate API key is configured.
 */
export function hasValidConfig(config?: AIConfig): boolean {
  const cfg = config || getDefaultConfig();
  return cfg.enabled && cfg.apiKey.length > 0 && cfg.model.length > 0;
}

/**
 * Validate that a model ID is in our allowed list.
 */
export function isValidModel(modelId: string): boolean {
  return AVAILABLE_MODELS.some((m) => m.id === modelId);
}
