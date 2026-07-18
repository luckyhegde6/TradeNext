/**
 * AI Safety Layer — Prompt injection detection, input sanitization, output filtering.
 *
 * Security measures:
 * 1. Input sanitization — Strip control chars, normalize Unicode
 * 2. Injection pattern detection — Known jailbreak and injection patterns
 * 3. Role boundary enforcement — Prevent system prompt leakage
 * 4. Output filtering — Remove sensitive patterns from AI responses
 * 5. Query length and complexity limits
 */
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export interface SafetyCheckResult {
  safe: boolean;
  sanitized: string;
  flags: string[];
  riskScore: number; // 0-100
}

export interface SafetyConfig {
  maxQueryLength: number;
  maxTokens: number;
  blockLevel: "low" | "medium" | "high";
}

// ─── Default config ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: SafetyConfig = {
  maxQueryLength: 4000,
  maxTokens: 4096,
  blockLevel: "medium",
};

// ─── Known injection patterns ────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  // System prompt leakage attempts
  /ignore\s+(all\s+)?(previous|above|system)\s+(instructions|prompts|directives)/i,
  /forget\s+(all\s+)?(previous|above|system)\s+(instructions|prompts|directives)/i,
  /disregard\s+(all\s+)?(previous|above|system)\s+(instructions|prompts|directives)/i,
  /you\s+are\s+(now|not\s+bound\s+by|free\s+from)\s+(your\s+)?(previous|system|instructions)/i,

  // Role manipulation
  /act\s+as\s+(if\s+you\s+are\s+)?(dan|jailbreak|unfiltered|unconstrained)/i,
  /new\s+character\s*:?\s*(dan|sudo|admin)/i,
  /from\s+now\s+on\s*,\s*you\s+(are|will|must)/i,

  // System prompt extraction
  /print\s+(the\s+)?(system|above|initial)\s+(prompt|instructions|message)/i,
  /repeat\s+(the\s+)?(words|text|prompt|instructions)\s+(above|below|initial)/i,
  /show\s+(the\s+)?(full|entire|complete)\s+(prompt|instructions|system)/i,
  /output\s+(the\s+)?(initial|system|first)\s+(prompt|message|text)/i,

  // Delimiter-based injection
  /```[\s\S]*?(system|user|assistant)\s*:[\s\S]*?```/i,
  /<\|im_start\|>\s*(system|user)/i,
  /\{\s*"role"\s*:\s*"(system|user)"/i,

  // Token manipulation
  /reset\s+(the\s+)?(conversation|context|session|chat)/i,
  /start\s+(a\s+)?new\s+(conversation|session|chat)/i,

  // Direct instruction override
  /respond\s+to\s+(the\s+)?(above|previous)\s+(as|without|ignoring)/i,
  /answer\s+(in\s+)?a\s+(different\s+)?(language|format|style)\s+(than|from)/i,
];

// ─── Sensitive output patterns to filter from AI responses ───────────────

const OUTPUT_FILTER_PATTERNS: RegExp[] = [
  // Potential API key leakage
  /\b(sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,}|[a-f0-9]{32,})\b/g,
  // Email addresses in unexpected context
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

// ─── Main safety check ───────────────────────────────────────────────────

/**
 * Sanitize and check a user input for prompt injection.
 * Returns the sanitized input plus safety flags.
 */
export function checkPromptSafety(
  input: string,
  config?: Partial<SafetyConfig>
): SafetyCheckResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const flags: string[] = [];
  let sanitized = input;
  const startTime = Date.now();

  // 1. Length check
  if (input.length > cfg.maxQueryLength) {
    flags.push(`query_length:${input.length}`);
    sanitized = input.slice(0, cfg.maxQueryLength);
  }

  // 2. Truncate to first 1000 chars for pattern matching (performance)
  const checkWindow = sanitized.slice(0, 1000);

  // 3. Injection pattern detection
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(checkWindow)) {
      const match = checkWindow.match(pattern);
      flags.push(`injection_pattern:${match?.[0]?.slice(0, 50) || "unknown"}`);
    }
  }

  // 4. Unicode normalization (remove zero-width, bidirectional chars)
  sanitized = sanitized
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // Zero-width chars
    .replace(/[\u202A-\u202E]/g, "") // Bidi override chars
    .replace(/[\u2060-\u2064]/g, "") // Invisible operators
    .replace(/\r\n/g, "\n")
    .normalize("NFKC");

  // 5. Control character removal (except newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 6. Calculate risk score
  let riskScore = 0;
  riskScore += Math.min(20, Math.floor(input.length / 200)); // Length-based
  riskScore += flags.length * 15; // Each flag adds 15 points

  // Heavy penalty for direct injection patterns
  const hasInjection = flags.some((f) => f.startsWith("injection_pattern"));
  if (hasInjection) riskScore += 30;

  const riskLevel = flags.some((f) => f.startsWith("injection_pattern"))
    ? "high"
    : flags.length > 2
    ? "medium"
    : "low";

  // Block based on level
  const isBlocked =
    cfg.blockLevel === "high" ||
    (cfg.blockLevel === "medium" && riskLevel === "high") ||
    (cfg.blockLevel === "low" && false);

  const safe = !isBlocked;

  if (!safe) {
    logger.warn({
      msg: "Prompt injection detected",
      riskLevel,
      riskScore,
      flags: flags.join(","),
      inputPreview: input.slice(0, 100),
    });
  }

  return {
    safe,
    sanitized: sanitized.trim(),
    flags,
    riskScore: Math.min(100, riskScore),
  };
}

/**
 * Filter sensitive content from AI responses before returning to user.
 */
export function filterAIResponse(response: string): string {
  let filtered = response;

  for (const pattern of OUTPUT_FILTER_PATTERNS) {
    filtered = filtered.replace(pattern, "[REDACTED]");
  }

  return filtered;
}

/**
 * Rate limit configuration for estimate token count.
 * Rough estimation: ~4 chars per token for English text.
 */
export function estimateTokenCount(text: string): number {
  // More accurate than just char/4 - accounts for whitespace
  const words = text.split(/\s+/).length;
  return Math.ceil(words * 1.3) + Math.ceil(text.length / 10);
}

/**
 * Estimate cost for a given model and token count.
 */
export function estimateCost(
  tokens: number,
  model: string = "openrouter/free"
): number {
  // Approximate costs per 1K tokens (USD)
  const rates: Record<string, { input: number; output: number }> = {
    "openai/gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    "openai/gpt-4o": { input: 0.0025, output: 0.01 },
    "anthropic/claude-3.5-sonnet": { input: 0.003, output: 0.015 },
    "google/gemini-2.0-flash": { input: 0.0001, output: 0.0004 },
    "meta-llama/llama-3.3-70b": { input: 0.00059, output: 0.00079 },
    "deepseek/deepseek-chat": { input: 0.00014, output: 0.00028 },
  };
  const rate = rates[model] || { input: 0, output: 0 };
  return (tokens / 1000) * (rate.input + rate.output) / 2;
}
