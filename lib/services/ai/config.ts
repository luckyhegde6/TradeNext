/**
 * AI Agent configuration.
 * Model selection and provider settings, configurable by admin.
 *
 * Models are FREE on OpenRouter. Prefer WEEKLY free models (higher quotas)
 * over daily free models (which hit rate limits quickly).
 * See: https://openrouter.ai/models?order=pricing-low-to-high
 */
import logger from "@/lib/logger";

/** Default model — weekly free model with high quota */
export const DEFAULT_MODEL = "tencent/hy3:free";

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
 *
 * WEEKLY free models (tencent/hy3:free) are preferred because they have
 * higher request quotas than daily free models.
 */
export const AVAILABLE_MODELS: ModelInfo[] = [
  // ── Weekly Free Models (preferred — higher quotas) ─────────────────────
  {
    id: "tencent/hy3:free",
    name: "Tencent HY3 (Weekly Free)",
    description: "295B MoE, reasoning + tools + structured outputs. Recommended default.",
    contextLength: 262_144,
    billingPeriod: "weekly",
  },
  // ── Daily Free Models (lower quotas, use as fallback) ──────────────────
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron 3 Super 120B (Daily)",
    description: "Strong reasoning, 1M context, structured outputs",
    contextLength: 1_000_000,
    billingPeriod: "daily",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra 550B (Daily)",
    description: "Highest quality free model, 1M context, best benchmarks",
    contextLength: 1_000_000,
    billingPeriod: "daily",
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct:free",
    name: "Qwen3 Next 80B (Daily)",
    description: "Good reasoning, structured outputs, 262K context",
    contextLength: 262_144,
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
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    name: "Nemotron 3 Nano 30B (Daily)",
    description: "Fast and efficient, 256K context",
    contextLength: 256_000,
    billingPeriod: "daily",
  },
  {
    id: "google/gemma-4-31b-it:free",
    name: "Gemma 4 31B (Daily)",
    description: "Google's latest open model, 262K context",
    contextLength: 262_144,
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
 * Priority: Admin DB config > .env defaults > hardcoded defaults.
 */
export function getDefaultConfig(): AIConfig {
  return {
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    apiKey: process.env.OPENROUTERKEY || process.env.OPENROUTER_API_KEY || "",
    temperature: 0.3,
    maxTokens: 2048,
    enabled: true,
  };
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
