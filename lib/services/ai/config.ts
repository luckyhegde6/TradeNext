/**
 * AI Agent configuration.
 * Model selection and provider settings, configurable by admin.
 */

export const DEFAULT_MODEL = "openrouter/free";
export const FALLBACK_MODEL = "openrouter/free";

export const AVAILABLE_MODELS = [
  { id: "openrouter/free", name: "OpenRouter Free (Default)", provider: "openrouter" },
  { id: "openrouter/auto", name: "OpenRouter Auto", provider: "openrouter" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "openrouter" },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "openrouter" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", provider: "openrouter" },
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "openrouter" },
  { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "openrouter" },
  { id: "meta-llama/llama-3.3-70b", name: "Llama 3.3 70B", provider: "openrouter" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", provider: "openrouter" },
  { id: "mistralai/mistral-7b", name: "Mistral 7B", provider: "openrouter" },
  { id: "qwen/qwen-2.5-72b", name: "Qwen 2.5 72B", provider: "openrouter" },
];

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
