// lib/services/nseRateGuard.ts
// NSE anti-blacklist discipline (Plan 09 Phase 3 / spec §4.3).
// Memory-only, zero DB, zero network, zero imports — safe to require anywhere
// including jest mocks. globalThis singletons so a duplicated module graph
// (Turbopack dev) shares one guard state, mirroring lib/prisma.ts / lib/sqlite.ts.
//
// Guards:
//  1. Single-flight   — concurrent identical NSE requests share one in-flight promise.
//  2. Min-interval    — per-endpoint-key minimum spacing (quote 1s, historical 250ms,
//                       chart 5s, index 2s, corp actions 30s, marquee 30s); dev override
//                       via NSE_THROTTLE_MS JSON env map ({ "historical": 250, ... }).
//  3. Burst cooldown  — after ≥5 NSE 403/419/429 responses within 60s, back off 60s;
//                       callers serve SQLite/stale instead of hitting NSE.
//  4. Boot stagger    — historical sync keeps its 200ms inter-symbol delay; the
//                       per-call throttle simply guarantees a floor, never a ceiling.

const g = globalThis as unknown as {
  __nseRateGuard?: {
    inflight: Map<string, Promise<unknown>>;
    lastCall: Map<string, number>;
    failures: number[]; // timestamps of 403/419/429 responses
    cooldownUntil: number; // 0 = none
  };
};

export const NSE_BURST_FAILURES = 5;
export const NSE_FAILURE_WINDOW_MS = 60_000;
export const NSE_COOLDOWN_MS = 60_000;
export const NSE_DEFAULT_THROTTLE_MS = 1_000;

/** Per-bucket minimum interval (ms) — see classifyEndpoint() for key derivation. */
const ENDPOINT_THROTTLE_MS: Record<string, number> = {
  historical: 250,
  chart: 5_000,
  index: 2_000,
  corporate: 30_000,
  marquee: 30_000,
  // quote falls back to NSE_DEFAULT_THROTTLE_MS (1s)
};

/** Dev override map parsed once at module load from NSE_THROTTLE_MS (JSON). */
function parseEnvOverrides(): Record<string, number> {
  const raw = process.env.NSE_THROTTLE_MS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

const ENV_OVERRIDES = parseEnvOverrides();

/** Classify an endpoint (path+query string) into a throttle bucket. */
export function classifyEndpoint(endpoint: string): string {
  const e = endpoint.toLowerCase();
  if (e.includes("historical")) return "historical"; // /api/historicalOR/generateSecurityWiseHistoricalData
  if (e.includes("graphchart") || e.includes("chart")) return "chart"; // ?functionName=getGraphChart / chart endpoints
  if (e.includes("indextracker") || e.includes("marketstatus")) return "index"; // /api/NextApi/apiClient/indexTrackerApi
  if (e.includes("corporate")) return "corporate"; // corporates-corporateActions, corporateAction APIs
  if (e.includes("marquee")) return "marquee";
  return "quote"; // GetQuoteApi / apiClient fallbacks — 1s default
}

/** Effective min-interval for an endpoint: env override > bucket default > 1s. */
export function getThrottleMs(endpoint: string): number {
  const bucket = classifyEndpoint(endpoint);
  return ENV_OVERRIDES[bucket] ?? ENDPOINT_THROTTLE_MS[bucket] ?? NSE_DEFAULT_THROTTLE_MS;
}

function state() {
  if (!g.__nseRateGuard) {
    g.__nseRateGuard = {
      inflight: new Map(),
      lastCall: new Map(),
      failures: [],
      cooldownUntil: 0,
    };
  }
  return g.__nseRateGuard;
}

/**
 * Single-flight: concurrent identical requests share the SAME promise object
 * (not an async wrapper — callers can identity-check and join in-progress
 * refreshes). The map entry is removed once the promise settles so a later
 * call starts fresh.
 */
export function withSingleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const s = state();
  const existing = s.inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (s.inflight.get(key) === p) s.inflight.delete(key);
    });
  s.inflight.set(key, p);
  return p;
}

/**
 * Min-interval throttle. Returns true when the call is allowed and records the
 * call time; false when the per-endpoint interval has not elapsed (skip the
 * NSE hit and serve stale/SQLite instead). Callers that hit false should NOT
 * call NSE.
 */
export function maybeThrottle(key: string, minIntervalMs: number): boolean {
  const s = state();
  const now = Date.now();
  const last = s.lastCall.get(key) ?? 0;
  if (now - last < minIntervalMs) return false;
  s.lastCall.set(key, now);
  return true;
}

/** Record a blacklist-prone failure (403/419/429). Other statuses are ignored. */
export function recordNseFailure(statusCode: number | null | undefined): void {
  if (statusCode !== 403 && statusCode !== 419 && statusCode !== 429) return;
  const s = state();
  const now = Date.now();
  s.failures = [...s.failures.filter((t) => now - t < NSE_FAILURE_WINDOW_MS), now];
  if (s.failures.length >= NSE_BURST_FAILURES) {
    s.cooldownUntil = now + NSE_COOLDOWN_MS;
  }
}

/** Back off for 60s after a burst. Never wipes a live failure window while the
 * cooldown is unset — only prunes (to in-window failures) once it expires. */
export function isNseCooldownActive(): boolean {
  const s = state();
  const now = Date.now();
  if (s.cooldownUntil > now) return true;
  if (s.cooldownUntil !== 0) {
    // Expired — prune to failures still inside the sliding window.
    s.cooldownUntil = 0;
    s.failures = s.failures.filter((t) => now - t < NSE_FAILURE_WINDOW_MS);
  }
  return false;
}

/** Sentinel thrown by fail-fast paths so callers serve stale/SQLite quietly. */
export class NseRateLimitedError extends Error {
  constructor(public readonly kind: "throttle" | "cooldown") {
    super(kind === "cooldown" ? "NSE cooldown active (rate guard)" : "NSE throttled (rate guard)");
    this.name = "NseRateLimitedError";
  }
}

/** Status for db-health / monitoring (zero DB). */
export function getNseRateGuardStatus(): {
  inflight: string[];
  lastCallAt: Record<string, number>;
  recentFailures: number;
  failureWindowMs: number;
  burstThreshold: number;
  cooldownActive: boolean;
  cooldownUntil: number | null;
  throttleOverrides: Record<string, number>;
} {
  const s = state();
  return {
    inflight: [...s.inflight.keys()],
    lastCallAt: Object.fromEntries(s.lastCall),
    recentFailures: s.failures.length,
    failureWindowMs: NSE_FAILURE_WINDOW_MS,
    burstThreshold: NSE_BURST_FAILURES,
    cooldownActive: isNseCooldownActive(),
    cooldownUntil: s.cooldownUntil || null,
    throttleOverrides: ENV_OVERRIDES,
  };
}

/** Test hook — clears all guard state in place. */
export function resetNseRateGuard(): void {
  g.__nseRateGuard = {
    inflight: new Map(),
    lastCall: new Map(),
    failures: [],
    cooldownUntil: 0,
  };
}