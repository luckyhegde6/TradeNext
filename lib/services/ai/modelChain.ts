// lib/services/ai/modelChain.ts
// PURE module — ZERO imports. Shared fallback-model ordering for AI agents.
//
// The primary model (config.model) is flaky in production (free-tier
// OpenRouter routes routinely 404/time out — the root cause of the prod
// all-HOLD runs since Jul 19). Every AI call site (recommendation-agent,
// swing-agent, ipoAnalysisService) tries the primary first, then these
// fallback routes, so one dead model no longer kills a whole batch.

/** Fallback routes probed in order when the configured model fails. */
export const AI_FALLBACK_MODELS = ["openrouter/free", "openrouter/auto"] as const;

/**
 * Primary + fallbacks as a deduped chain (empty primary dropped). The primary
 * model gets its full retry budget; each fallback is tried once (they are
 * last-resort routes — the caller's deadline bounds total latency).
 */
export function modelFallbackChain(primary?: string | null): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  for (const m of [primary, ...AI_FALLBACK_MODELS]) {
    if (!m) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    chain.push(m);
  }
  return chain;
}
