// lib/services/readTier.ts
//
// v3.23.x — Read-tier + cache + SQLite performance telemetry.
//
// The db-health dashboard used to show "cache utilisation 0%". That was NOT a
// bug: NodeCache.getStats() hits/misses are *in-memory per-process* counters
// that reset to 0 on every deploy/restart (and on every flushAll), and most
// hot reads short-circuit at the SQLite mirror / their own caches before ever
// reaching the generic lib/cache.ts NodeCache instances. So a freshly booted
// process with no cache reads yet reports hits=0 -> hitRate 0%.
//
// To make utilisation observable we instrument the actual read path centrally:
//   - SQLite mirror read helpers (lib/sqlite.ts) report their latency + rows,
//     giving a real SQLite performance (latency) section.
//   - The hot route read sources (recommendations / swing / screener / corp
//     actions) record which tier served them (sqlite / memory / prisma) and
//     whether it was a cache hit, giving high-frequency + low-frequency query
//     hit counts.
//   - Reads slower than LONG_QUERY_MS are captured in a bounded ring as
//     "long / large queries".
//
// All counters are in-memory and live on globalThis (single-writer pattern,
// mirroring lib/prisma.ts) so every module instance of the Next.js dev
// module-graph shares ONE registry. db-health reads are zero-Prisma: this
// module touches no database.

export type ReadSource = "sqlite" | "memory" | "prisma" | "nse" | "filesystem" | "other";

export interface ReadMetric {
  name: string;
  source: ReadSource;
  hits: number;
  misses: number;
  calls: number;
  latency: { last: number; min: number; max: number; avg: number };
  rows: number;
}

export interface LongQuery {
  name: string;
  source: ReadSource;
  latencyMs: number;
  rows: number;
  at: string;
}

export interface SourceAgg {
  calls: number;
  hits: number;
  misses: number;
  totalMs: number;
  minMs: number | null;
  maxMs: number | null;
  rows: number;
}

export interface SqlitePerf {
  calls: number;
  totalMs: number;
  avgMs: number;
  minMs: number | null;
  maxMs: number | null;
}

export interface ReadTierSnapshot {
  byReader: ReadMetric[];
  bySource: Record<ReadSource, SourceAgg>;
  longQueries: LongQuery[];
  totalCalls: number;
  sqlite: SqlitePerf;
}

/** Reads exceeding this latency (ms) are captured as "long / large queries". */
export const LONG_QUERY_MS = 100;

const SOURCES: ReadSource[] = ["sqlite", "memory", "prisma", "nse", "filesystem", "other"];

interface ReaderState {
  source: ReadSource;
  hits: number;
  misses: number;
  totalMs: number;
  minMs: number | null;
  maxMs: number | null;
  lastMs: number;
  rows: number;
  calls: number;
}

interface Registry {
  readers: Record<string, ReaderState>;
  bySource: Record<ReadSource, Record<"rowCount" | "totalMs" | "hits" | "misses", number> & { minMs: number | null; maxMs: number | null }>;
  long: LongQuery[];
  totalCalls: number;
}

const MAX_LONG = 15;

const globalForReadTier = globalThis as unknown as { __readTier?: Registry };

function sourceZero() {
  return { rowCount: 0, totalMs: 0, hits: 0, misses: 0, minMs: null, maxMs: null };
}

function registry(): Registry {
  if (!globalForReadTier.__readTier) {
    const bySource = {} as Registry["bySource"];
    for (const s of SOURCES) bySource[s] = sourceZero();
    globalForReadTier.__readTier = { readers: {}, bySource, long: [], totalCalls: 0 };
  }
  return globalForReadTier.__readTier;
}

/**
 * Record a read. `hit` = served by cache/SQLite mirror without touching a
 * higher tier (i.e. that read did NOT consume a Prisma op). latencyMs should
 * reflect only the read itself. rows = rows returned (approx).
 */
export function recordRead(
  name: string,
  opts: { source?: ReadSource; latencyMs?: number; rows?: number; hit?: boolean } = {},
): void {
  const reg = registry();
  const source = opts.source ?? "other";
  const latencyMs = opts.latencyMs ?? 0;
  const rows = opts.rows ?? 0;
  const hit = opts.hit ?? false;

  reg.totalCalls += 1;

  let r = reg.readers[name];
  if (!r) {
    r = reg.readers[name] = {
      source,
      hits: 0,
      misses: 0,
      totalMs: 0,
      minMs: null,
      maxMs: null,
      lastMs: 0,
      rows: 0,
      calls: 0,
    };
  }
  r.calls += 1;
  r.lastMs = latencyMs;
  r.totalMs += latencyMs;
  if (r.minMs == null || latencyMs < r.minMs) r.minMs = latencyMs;
  if (r.maxMs == null || latencyMs > r.maxMs) r.maxMs = latencyMs;
  r.rows = rows; // last observed row count (approximate, avoids unbounded growth)
  if (hit) r.hits += 1;
  else r.misses += 1;

  const s = reg.bySource[source];
  s.rowCount += rows;
  s.totalMs += latencyMs;
  if (s.minMs == null || latencyMs < s.minMs) s.minMs = latencyMs;
  if (s.maxMs == null || latencyMs > s.maxMs) s.maxMs = latencyMs;
  if (hit) s.hits += 1;
  else s.misses += 1;

  if (latencyMs > LONG_QUERY_MS) {
    reg.long.push({ name, source, latencyMs, rows, at: new Date().toISOString() });
    if (reg.long.length > MAX_LONG) reg.long = reg.long.slice(reg.long.length - MAX_LONG);
  }
}

/** Zero-cost snapshot of the registry (no DB, pure memory read). */
export function getReadMetrics(): ReadTierSnapshot {
  const reg = registry();

  const byReader: ReadMetric[] = Object.entries(reg.readers)
    .map(([name, r]) => ({
      name,
      source: r.source,
      hits: r.hits,
      misses: r.misses,
      calls: r.calls,
      latency: {
        last: r.lastMs,
        min: r.minMs ?? 0,
        max: r.maxMs ?? 0,
        avg: r.calls ? Math.round(r.totalMs / r.calls) : 0,
      },
      rows: r.rows,
    }))
    .sort((a, b) => b.calls - a.calls);

  const bySource = {} as Record<ReadSource, SourceAgg>;
  for (const key of SOURCES) {
    const s = reg.bySource[key];
    const calls = s.hits + s.misses;
    bySource[key] = {
      calls,
      hits: s.hits,
      misses: s.misses,
      totalMs: s.totalMs,
      minMs: s.minMs,
      maxMs: s.maxMs,
      rows: s.rowCount,
    };
  }

  const sql = bySource["sqlite"];
  const sqlite: SqlitePerf = {
    calls: sql.calls,
    totalMs: sql.totalMs,
    avgMs: sql.calls ? Math.round(sql.totalMs / sql.calls) : 0,
    minMs: sql.minMs,
    maxMs: sql.maxMs,
  };

  return {
    byReader,
    bySource,
    longQueries: reg.long.slice().sort((a, b) => b.latencyMs - a.latencyMs),
    totalCalls: reg.totalCalls,
    sqlite,
  };
}

/** Reset all counters (tests / admin "Reset" action). */
export function resetReadMetrics(): void {
  globalForReadTier.__readTier = undefined;
}