// lib/services/accelerateProbe.ts
//
// Spec 28 (v3.49.0): Accelerate connectivity probe for Netlify.
//
// Prod evidence 2026-10-11: the daily-recommendations pipeline ran a *failed* run
// (`347d6887…`, runDate 2026-09-04) and the stale-task reaper logged
// "Stale recommendation-run reap failed … Unable to connect to the Accelerate API"
// every minute — the P2002/breaker guard never opened, yet every Prisma read was
// timing out at the *network* layer (Accelerate proxy unreachable from Netlify).
//
// This module gives operators (and the reaper itself) a cheap, TTL-cached way to
// distinguish "DB genuinely answered" from "Accelerate is unreachable", so the
// reaper can skip its 4-read sweep while the network is down instead of spraying
// fails every 5 minutes.
//
// Design invariants (from spec 28):
//  - A probe is a single `SELECT 1` raw read with a hard timeout — never a write,
//    never a transaction, never a 5xx. Failures are *states*, not exceptions.
//  - Results are cached for ACCELERATE_PROBE_TTL_MS (default 60s): the reaper and
//    the admin route share one answer window instead of hammering the proxy.
//  - Breaker open (P6003 hold) short-circuits straight to `state:"open"` — no
//    probe needed, the read path is guaranteed unusable.
//  - Admin-triggered probes are audited with ACCELERATE_PROBE (secrets never);
//    the reaper logs at warn level instead of auditing.
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { isPlanLimitBreakerOpen, isDbUnavailableError } from "@/lib/db-utils";
import { randomUUID } from "crypto";

export type AccelerateProbeState = "unknown" | "ok" | "unreachable" | "open";

export interface AccelerateProbeResult {
  /** ok = SELECT 1 answered · unreachable = timeout/network/DB error · open = plan-limit breaker · unknown = never probed */
  state: AccelerateProbeState;
  /** Round-trip latency of a successful SELECT 1 in ms; null when the probe did not answer. */
  latencyMs: number | null;
  /** ISO timestamp of this probe attempt. */
  checkedAt: string;
  probeId: string;
  /** Effective TTL used for this probe window. */
  ttlMs: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;

function ttlMs(): number {
  const raw = Number(process.env.ACCELERATE_PROBE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_TTL_MS;
}

function timeoutMs(): number {
  const raw = Number(process.env.ACCELERATE_PROBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_TIMEOUT_MS;
}

let cached: AccelerateProbeResult | null = null;

/** Last cached probe result — the console card can render it without re-probing. */
export function getCachedAccelerateProbe(): AccelerateProbeResult | null {
  return cached;
}

/** Test-only hook: clear the cached probe so each Jest case starts fresh. */
export function resetAccelerateProbeCacheForTests(): void {
  cached = null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Race a promise against a hard timeout and always clear the timer. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Probe Accelerate reachability with a TTL-cached `SELECT 1`.
 *
 * Never throws (except on a programmer error): every failure mode is folded into
 * the returned state. `force` bypasses the TTL cache (admin "test" button).
 */
export async function probeAccelerate(opts: { force?: boolean } = {}): Promise<AccelerateProbeResult> {
  const force = opts.force === true;
  const now = Date.now();

  if (!force && cached && now - Date.parse(cached.checkedAt) < cached.ttlMs) {
    return cached;
  }

  if (isPlanLimitBreakerOpen()) {
    const result: AccelerateProbeResult = {
      state: "open",
      latencyMs: null,
      checkedAt: nowIso(),
      probeId: randomUUID(),
      ttlMs: ttlMs(),
    };
    cached = result;
    return result;
  }

  const probeId = randomUUID();
  const startedAt = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, timeoutMs(), "Accelerate probe");
    const result: AccelerateProbeResult = {
      state: "ok",
      latencyMs: Date.now() - startedAt,
      checkedAt: nowIso(),
      probeId,
      ttlMs: ttlMs(),
    };
    cached = result;
    return result;
  } catch (error) {
    logger.warn({
      msg: "Accelerate probe failed",
      probeId,
      error: error instanceof Error ? error.message : String(error),
      dbClassified: isDbUnavailableError(error),
    });
    const result: AccelerateProbeResult = {
      state: "unreachable",
      latencyMs: null,
      checkedAt: nowIso(),
      probeId,
      ttlMs: ttlMs(),
    };
    cached = result;
    return result;
  }
}

/**
 * Should background sweep work (the stale-task reaper) be withheld right now?
 *
 * True when the plan-limit breaker is open OR the last probe answered unreachable.
 * Conservative by design: with NO cached evidence of an outage it returns false,
 * so a healthy DB is never skipped because of a stale negative cache.
 */
export async function shouldSkipReap(): Promise<boolean> {
  if (isPlanLimitBreakerOpen()) return true;
  const probe = await probeAccelerate();
  return probe.state === "unreachable";
}