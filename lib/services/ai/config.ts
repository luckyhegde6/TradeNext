/**
 * AI Agent configuration.
 * Model selection and provider settings, configurable by admin.
 *
 * All models listed here are FREE on OpenRouter and support tool calling (tools ✅).
 * See: https://openrouter.ai/models?order=pricing-low-to-high
 */
import logger from "@/lib/logger";

export const DEFAULT_MODEL = "openrouter/free";

export interface ModelInfo {
  id: string;
  name: string;
  /** Short description of the model's strengths */
  description?: string;
  /** Estimated context window in tokens */
  contextLength?: number;
}

/**
 * Available free models on OpenRouter.
 *
 * Selection criteria:
 * - pricing.prompt = $0, pricing.completion = $0
 * - supports "tools" and "tool_choice" parameters
 * - no imminent expiration date
 * - diverse range of capabilities
 */
export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: "openrouter/free",
    name: "OpenRouter Free (Auto-Router)",
    description: "Routes to the best free model for each request. Recommended default.",
    contextLength: 200_000,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "Nemotron 3 Super 120B",
    description: "Strong reasoning, 1M context, structured outputs",
    contextLength: 1_000_000,
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra 550B",
    description: "Highest quality free model, 1M context",
    contextLength: 1_000_000,
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    name: "Nemotron 3 Nano 30B",
    description: "Fast and efficient, 256K context",
    contextLength: 256_000,
  },
  {
    id: "google/gemma-4-31b-it:free",
    name: "Gemma 4 31B",
    description: "Google's latest open model, 262K context",
    contextLength: 262_144,
  },
  {
    id: "openai/gpt-oss-20b:free",
    name: "GPT-OSS 20B",
    description: "OpenAI's open-source model, 131K context",
    contextLength: 131_072,
  },
  {
    id: "nvidia/nemotron-nano-9b-v2:free",
    name: "Nemotron Nano 9B V2",
    description: "Lightweight and fast, 128K context",
    contextLength: 128_000,
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
