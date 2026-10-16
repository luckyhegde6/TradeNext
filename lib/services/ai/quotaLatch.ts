/**
 * AI daily-quota latch (v3.51.0).
 *
 * WHY THIS EXISTS. OpenRouter's free tier returns HTTP 429 with
 * `free-models-per-day` once the account's free daily budget is spent. The
 * budget is ACCOUNT-WIDE, so every subsequent model in the fallback chain —
 * and every subsequent daily-recommendation attempt inside the same UTC day —
 * fails the same way. Before this module the pipeline simply ran to failure on
 * each retry (100 stocks × batches × models), producing ~70 failed runs/notices
 * on 2026-10-14/15 with zero chance of success.
 *
 * WHAT IT DOES. The first time a *daily free quota* 429 is observed the day is
 * latched. For the rest of that UTC day `analyzeStocks` short-circuits (no HTTP
 * calls) and admin surfaces show the state. The latch is self-clearing: it is
 * ignored (and removed) once the stored UTC day no longer matches today, or the
 * provider-supplied `resetAt` has passed.
 *
 * ZERO PRISMA. Persistence rides the local SQLite `_backup_meta` KV table,
 * because a quota latch is most useful precisely when the DB may also be
 * degraded. Reads fall back to an in-process `globalThis` copy so a cold SQLite
 * mirror never disables the short-circuit mid-instance.
 *
 * It deliberately latches ONLY on the *daily free* quota — a transient
 * per-minute rate limit must NOT disable the AI for a whole day.
 */
import logger from "@/lib/logger";
import {
  persistBackupMeta,
  restoreBackupMeta,
  deleteBackupMeta,
} from "@/lib/sqlite";

const META_KEY = "ai_quota_exhausted";

/** A latch record: valid for `utcDay`, expiring at the latest at `resetAt`. */
export interface AiQuotaRecord {
  utcDay: string;
  markedAt: string;
  resetAt: string | null;
  detail: string | null;
  model: string | null;
}

export interface AiQuotaStatus {
  exhausted: boolean;
  utcDay: string | null;
  markedAt: string | null;
  resetAt: string | null;
  detail: string | null;
  model: string | null;
}

// Module-level memo so a warm lambda serves the latch without a KV read.
// Typed form matches opsMonthly/degradedMode/leader (no `any`, no disable).
const g = globalThis as unknown as { __aiQuotaLatch?: AiQuotaRecord | null };

/** `YYYY-MM-DD` in UTC — the latch's scope key. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Next UTC midnight (the free-tier reset boundary) as an ISO string. */
function nextUtcMidnight(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return d.toISOString();
}

/**
 * True only for the *daily free* quota exhaustion — i.e. an OpenRouter 429
 * whose message names the free-model daily budget. A generic 429 (per-minute
 * rate limit) intentionally returns false: it must never latch a whole day.
 */
export function isDailyFreeQuotaMessage(raw: string): boolean {
  if (!raw) return false;
  const s = raw.toLowerCase();
  return (
    s.includes("free-models-per-day") ||
    s.includes("free models per day") ||
    (s.includes("free-model") && s.includes("day"))
  );
}

function isRecord(v: unknown): v is AiQuotaRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.utcDay === "string" && typeof r.markedAt === "string";
}

/** In-memory record, else the persisted one. Never throws. */
function readLatched(): AiQuotaRecord | null {
  const mem = g.__aiQuotaLatch;
  if (isRecord(mem)) return mem;
  try {
    const raw = restoreBackupMeta(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch (err) {
    logger.debug({
      msg: "AI quota latch: unreadable persisted record",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function clearPersisted(): void {
  g.__aiQuotaLatch = null;
  try {
    deleteBackupMeta(META_KEY);
  } catch {
    /* never throw from a latch reset */
  }
}

/**
 * Latch the current UTC day as AI-quota-exhausted. Idempotent; never throws.
 * Safe to call from any process (worker, route, executor).
 */
export function markAiQuotaExhausted(opts: {
  detail?: string | null;
  model?: string | null;
  resetAt?: string | null;
  now?: Date;
} = {}): AiQuotaRecord {
  const now = opts.now ?? new Date();
  const record: AiQuotaRecord = {
    utcDay: todayUtc(now),
    markedAt: now.toISOString(),
    resetAt: opts.resetAt ?? nextUtcMidnight(now),
    detail: opts.detail ? opts.detail.slice(0, 300) : null,
    model: opts.model ?? null,
  };
  g.__aiQuotaLatch = record;
  try {
    persistBackupMeta(META_KEY, JSON.stringify(record));
  } catch {
    /* memory latch alone is enough to short-circuit this instance */
  }
  logger.warn({
    msg: "AI daily free quota exhausted — latched for the rest of the UTC day",
    utcDay: record.utcDay,
    resetAt: record.resetAt,
    model: record.model,
    detail: record.detail,
  });
  return record;
}

/**
 * Current latch status. Auto-clears (memory + SQLite) when the stored UTC day
 * has rolled over or `resetAt` has passed — so no external reset job is needed.
 */
export function getAiQuotaStatus(now: Date = new Date()): AiQuotaStatus {
  const rec = readLatched();
  if (!rec) {
    return { exhausted: false, utcDay: null, markedAt: null, resetAt: null, detail: null, model: null };
  }
  const dayRolled = rec.utcDay !== todayUtc(now);
  const expired = rec.resetAt != null && Date.parse(rec.resetAt) <= now.getTime();
  if (dayRolled || expired) {
    clearPersisted();
    logger.info({
      msg: "AI quota latch cleared",
      reason: dayRolled ? "utc-day-rollover" : "reset-passed",
      utcDay: rec.utcDay,
    });
    return { exhausted: false, utcDay: null, markedAt: null, resetAt: null, detail: null, model: null };
  }
  return {
    exhausted: true,
    utcDay: rec.utcDay,
    markedAt: rec.markedAt,
    resetAt: rec.resetAt,
    detail: rec.detail,
    model: rec.model,
  };
}

/** True while the AI is latched off for the current UTC day. */
export function isAiQuotaExhausted(now: Date = new Date()): boolean {
  return getAiQuotaStatus(now).exhausted;
}

/** Operator clear (admin action). Never throws. */
export function clearAiQuotaExhausted(): void {
  clearPersisted();
  logger.info({ msg: "AI quota latch cleared by operator" });
}

/** Test hook — reset in-memory + persisted state deterministically. */
export function __resetAiQuotaLatchForTests(): void {
  clearPersisted();
}
