// lib/services/decision/client.ts
// ph22 Decision engine — client factory (spec §6).
//
// createDecisionClient() builds the provider chain from `DECISION_PROVIDER`:
//   none  → inert (NOOP — the production default; every workflow keeps exactly
//           its current behavior)
//   laya  → [LayaMockProvider] — the JS-adapted Laya engine (mock until the
//           P1–P3 semantic-parity gate lands; answers still follow Laya's
//           decode contract: argmax choice, expected-value score, p[1] noul,
//           confidence from probability shape)
// Any unknown value → warn once + inert (treated as `none`).
//
// evaluate() runs the chain with retry ≤3 / exponential backoff (250/500/1000ms).
// NOOP → null. Every answer exposes the answering provider + latency.
import logger from "@/lib/logger";
import { LayaMockProvider } from "./layaProvider";
import { trackDecisionTrace } from "./monitoring";
import type { DecisionProvider } from "./provider";
import type { EvaluateRequest, EvaluateResponse } from "./types";

export type DecisionProviderMode = "none" | "laya";

const RETRY_DELAYS_MS = [250, 500, 1000];

interface DecisionClient {
  /** Resolved mode (after unknown → none coercion). */
  mode(): DecisionProviderMode;
  /** `["laya-mock"]` | `[]` for none. */
  providers(): string[];
  evaluate(req: EvaluateRequest): Promise<EvaluateResponse | null>;
  ping(): Promise<{ mode: DecisionProviderMode; providers: string[]; detail: string }>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Unique question types in a request, e.g. ["choice","noul"]. */
function uniqueQuestionTypes(req: EvaluateRequest): string[] {
  return [...new Set(req.questions.map((q) => q.type))];
}

function parseMode(raw: string | undefined): DecisionProviderMode {
  switch ((raw ?? "none").toLowerCase().trim()) {
    case "none":
    case "":
      return "none";
    case "laya":
      return "laya";
    default: {
      logger.warn({ msg: "Unknown DECISION_PROVIDER — falling back to none (inert)", raw });
      return "none";
    }
  }
}

function buildProviders(mode: DecisionProviderMode): DecisionProvider[] {
  if (mode === "none") return [];
  return [new LayaMockProvider()];
}

/**
 * Evaluate with a provider: retry ≤3 (exp backoff) then throw. Latency is
 * captured per attempt; the winning attempt's latency is returned.
 */
async function evaluateWithRetry(
  provider: DecisionProvider,
  req: EvaluateRequest
): Promise<{ response: EvaluateResponse; latencyMs: number; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const started = Date.now();
    try {
      const response = await provider.evaluate(req);
      const latencyMs = Date.now() - started;
      return {
        response: { ...response, latencyMs: response.latencyMs ?? latencyMs },
        latencyMs,
        attempts: attempt + 1,
      };
    } catch (err) {
      lastError = err;
      logger.warn({
        msg: "Decision provider attempt failed",
        provider: provider.provider,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export function createDecisionClient(env: NodeJS.ProcessEnv = process.env): DecisionClient {
  const mode = parseMode(env.DECISION_PROVIDER);
  return createClientWithProviders(mode, buildProviders(mode));
}

/** Test seam — build a client from an explicit provider list (retry tests). */
export function _createDecisionClientWithProviders(
  mode: DecisionProviderMode,
  providers: DecisionProvider[]
): DecisionClient {
  return createClientWithProviders(mode, providers);
}

function createClientWithProviders(mode: DecisionProviderMode, providers: DecisionProvider[]): DecisionClient {
  logger.info({
    msg: "Decision engine client initialized",
    mode,
    providers: providers.map((p) => p.provider),
    mock: providers.some((p) => p.provider === "laya-mock"),
  });

  return {
    mode: () => mode,
    providers: () => providers.map((p) => p.provider),

    async evaluate(req: EvaluateRequest): Promise<EvaluateResponse | null> {
      // Inert NOOP — record a trace so admins can see the engine is off.
      if (providers.length === 0) {
        trackDecisionTrace({
          timestamp: new Date().toISOString(),
          kind: "evaluate",
          mode,
          status: "inert",
          latencyMs: 0,
          questionCount: req.questions.length,
          questionTypes: uniqueQuestionTypes(req),
        });
        return null;
      }

      const started = Date.now();
      let lastError: unknown;
      let totalAttempts = 0;
      for (let i = 0; i < providers.length; i += 1) {
        const provider = providers[i];
        try {
          const { response, latencyMs, attempts } = await evaluateWithRetry(provider, req);
          totalAttempts += attempts;
          trackDecisionTrace({
            timestamp: new Date().toISOString(),
            kind: "evaluate",
            mode,
            provider: provider.provider,
            status: "success",
            latencyMs,
            attempts: totalAttempts,
            questionCount: req.questions.length,
            questionTypes: uniqueQuestionTypes(req),
          });
          return response;
        } catch (err) {
          lastError = err;
          totalAttempts += RETRY_DELAYS_MS.length + 1; // exhausted retries for this provider
        }
      }
      // All providers exhausted — record the failure, then preserve the throw.
      trackDecisionTrace({
        timestamp: new Date().toISOString(),
        kind: "evaluate",
        mode,
        provider: providers.map((p) => p.provider).join(","),
        status: "error",
        latencyMs: Date.now() - started,
        attempts: totalAttempts,
        questionCount: req.questions.length,
        questionTypes: uniqueQuestionTypes(req),
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });
      throw lastError;
    },

    async ping() {
      const started = Date.now();
      const health: string[] = [];
      for (const p of providers) {
        try {
          const h = await p.health();
          health.push(`${p.provider}: ${h.ok ? "ok" : h.detail ?? "unhealthy"}`);
        } catch (err) {
          health.push(`${p.provider}: error ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      trackDecisionTrace({
        timestamp: new Date().toISOString(),
        kind: "ping",
        mode,
        provider: providers.map((p) => p.provider).join(",") || undefined,
        status: "success",
        latencyMs: Date.now() - started,
        reason: health.join(" · ") || undefined,
      });
      return {
        mode,
        providers: providers.map((p) => p.provider),
        detail: health.length > 0 ? health.join(" · ") : "none — decision engine is inert (DECISION_PROVIDER=none)",
      };
    },
  };
}

/** Singleton client (module-scope, mirrors logger/leader patterns). */
let clientSingleton: ReturnType<typeof createDecisionClient> | null = null;

/** Get the shared client — re-created when env changes between tests via _resetDecisionClient. */
export function getDecisionClient(): ReturnType<typeof createDecisionClient> {
  if (!clientSingleton) clientSingleton = createDecisionClient();
  return clientSingleton;
}

/** Test seam — drop the singleton so the next getDecisionClient() rebuilds from env. */
export function _resetDecisionClient(): void {
  clientSingleton = null;
}

/** Test seam — install an explicit client (e.g. one built with fake providers). */
export function _setDecisionClient(client: ReturnType<typeof createDecisionClient>): void {
  clientSingleton = client;
}