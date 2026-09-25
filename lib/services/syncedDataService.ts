// lib/services/syncedDataService.ts
//
// Shared fetch chain for NSE/TradingView reference data that is slow-moving
// (IPO issue calendar, community trading ideas, …) and must survive
// process restarts without hammering the upstream API:
//
//   Read path      : memory cache  →  NSE/TV API  →  market_cache DB
//   DB write path  : ONLY when the fetched payload CHANGED relative to the
//                    last stored one (skip identical writes — avoids churn
//                    once the 24h TTL window passes with no upstream change).
//   DB role        : fallback ONLY — served when memory is empty AND the API
//                    call failed (cold start + upstream outage resilience).
//
// The MarketCache table (prisma.marketCache) is the persistent store, exactly
// like lib/market-cache.ts — no new tables required.

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import cache from "@/lib/cache";
import { getSqliteFallback } from "@/lib/sqlite";
import { isPlanLimitBreakerOpen, isDbUnavailableError } from "@/lib/db-utils";

/** Default sync window — 24 hours. Upstream data (IPO calendar, ideas) changes
 *  at most daily, so we refetch no more often than this. */
export const DEFAULT_SYNC_TTL_SECONDS = 24 * 60 * 60;

/** TTL applied to memory entries populated from the DB fallback. Kept short so
 *  the next read retries the upstream API instead of serving stale data for
 *  the full 24h window. */
const FALLBACK_MEM_TTL_SECONDS = 5 * 60;

/**
 * Best-effort mirror write-through (non-fatal). Keeps the SQLite `market_cache`
 * mirror fresh when the Prisma write is skipped under the plan-limit hold, so
 * SQLite-first reads never serve an empty marketplace. Mirrors the Prisma
 * upsert shape exactly (camelCase keys accepted by upsertMarketCache).
 */
function mirrorWriteThrough(
  cacheKey: string,
  dataType: string,
  indexName: string | undefined,
  data: unknown,
  syncedAt: Date,
  ttlSeconds: number
): void {
  try {
    const sqlite = getSqliteFallback();
    if (!sqlite) return;
    const existing = sqlite.getMarketCache(cacheKey);
    const unchanged = existing !== null && stableStringify(existing.data) === stableStringify(data);
    if (unchanged) return; // mirror already in sync — avoid churn
    sqlite.upsertMarketCache({
      cacheKey,
      dataType,
      indexName: indexName || null,
      data: data as object,
      recordCount: Array.isArray(data) ? data.length : 1,
      lastSyncedAt: syncedAt,
      nextSyncAt: new Date(syncedAt.getTime() + ttlSeconds * 1000),
      marketStatus: "closed",
      syncStatus: "idle",
      syncError: null,
    });
  } catch (error) {
    logger.warn({
      msg: "SyncedData: mirror write-through failed",
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Mirror read helper for the step-3 fallback: returns { data, lastSyncedAt }
 * or null when the SQLite mirror has no row for this cacheKey.
 */
function mirrorReadMarketCache(
  cacheKey: string
): { data: unknown; lastSyncedAt: Date | null } | null {
  const sqlite = getSqliteFallback();
  if (!sqlite) return null;
  const row = sqlite.getMarketCache(cacheKey);
  if (row === null || row.data == null) return null;
  const lastSyncedAt = row.last_synced_at ? new Date(String(row.last_synced_at)) : null;
  return { data: row.data, lastSyncedAt };
}

/**
 * Stable JSON serialization — recursively sorts object keys so semantically
 * identical payloads produce identical strings even when key order differs.
 * Needed because Postgres jsonb reorders object keys alphabetically on read,
 * so naive JSON.stringify(DB_row) !== JSON.stringify(live_payload) would make
 * every payload look "changed" and defeat DB-write skipping.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface SyncedFetchOptions<T> {
  /** Unique cache key — used for both the memory entry and the DB row. */
  cacheKey: string;
  /** MarketCache.dataType value (e.g. "ipo_upcoming", "tv_ideas_nse"). */
  dataType: string;
  /** Optional MarketCache.indexName value. */
  indexName?: string;
  /** TTL in seconds (defaults to 24h). */
  ttlSeconds?: number;
  /** Fetches the payload from the upstream API (NSE / TradingView). */
  fetchFromApi: () => Promise<T>;
}

export interface SyncedFetchResult<T> {
  data: T;
  /** Where the payload came from: memory cache, upstream API, or DB fallback. */
  source: "cache" | "api" | "db";
  /** When the payload was last (re)written to the DB — null if never. */
  syncedAt: Date | null;
  /** Whether this call wrote the DB (true only when the payload changed). */
  changed: boolean;
}

/**
 * Fetch reference data with the memory → API → DB chain.
 *
 *   1. Memory cache hit          → return immediately (0 DB/API ops)
 *   2. NSE/TV API fetch          → compare with the persisted row; write the
 *                                  DB ONLY when the payload changed (or no row
 *                                  exists); populate memory; return "api"
 *   3. DB fallback (rare)        → only when memory was empty (or forceRefresh
 *                                  was used) AND the API call threw: serve the
 *                                  last persisted row, repopulate memory with a
 *                                  short TTL so we retry the API soon
 *
 * Throws only when the API failed AND no DB row exists (nothing usable to
 * return). Callers should treat that as "no data" and degrade gracefully.
 */
export async function getOrFetchSyncedData<T>(
  options: SyncedFetchOptions<T>,
  forceRefresh = false
): Promise<SyncedFetchResult<T>> {
  const {
    cacheKey,
    dataType,
    indexName,
    ttlSeconds = DEFAULT_SYNC_TTL_SECONDS,
    fetchFromApi,
  } = options;

  const memKey = `sync:${cacheKey}`;

  // 1) Memory front layer — 0 DB/API ops on hit.
  if (!forceRefresh) {
    const mem = cache.get<{ data: T; syncedAt: Date }>(memKey);
    if (mem) {
      return { data: mem.data, source: "cache", syncedAt: mem.syncedAt, changed: false };
    }
  }

  // 2) Upstream API + change-detected DB sync.
  try {
    const data = await fetchFromApi();
    const syncedAt = new Date();

    if (isPlanLimitBreakerOpen()) {
      // Hold-proof: skip the Prisma change-check/write entirely (zero ops) and
      // mirror-write only. The fresh API payload is served as-is.
      logger.warn({
        msg: "SyncedData: DB sync skipped (plan hold) — serving API payload",
        cacheKey,
      });
      mirrorWriteThrough(cacheKey, dataType, indexName, data, syncedAt, ttlSeconds);
      cache.set(memKey, { data, syncedAt }, ttlSeconds);
      return { data, source: "api", syncedAt, changed: false };
    }

    try {
      const existing = await prisma.marketCache.findUnique({ where: { cacheKey } });
      const unchanged =
        existing !== null && stableStringify(existing.data) === stableStringify(data);

      if (!unchanged) {
        await prisma.marketCache.upsert({
          where: { cacheKey },
          create: {
            cacheKey,
            dataType,
            indexName: indexName || null,
            data: data as object,
            recordCount: Array.isArray(data) ? data.length : 1,
            nseLastModified: null,
            lastSyncedAt: syncedAt,
            nextSyncAt: new Date(syncedAt.getTime() + ttlSeconds * 1000),
            marketStatus: "closed",
            syncStatus: "idle",
            syncError: null,
          },
          update: {
            data: data as object,
            recordCount: Array.isArray(data) ? data.length : 1,
            lastSyncedAt: syncedAt,
            nextSyncAt: new Date(syncedAt.getTime() + ttlSeconds * 1000),
            syncStatus: "idle",
            syncError: null,
          },
        });
        logger.info({
          msg: "SyncedData: DB synced (payload changed)",
          cacheKey,
          recordCount: Array.isArray(data) ? data.length : 1,
        });
      } else {
        logger.info({
          msg: "SyncedData: payload unchanged after TTL — DB write skipped",
          cacheKey,
        });
      }

      cache.set(memKey, { data, syncedAt }, ttlSeconds);
      return { data, source: "api", syncedAt, changed: !unchanged };
    } catch (dbError) {
      // Plan hold on the write path (breaker raced to open after the fetch):
      // the API call SUCCEEDED, so never fail — serve the fresh payload and
      // best-effort the mirror write-through.
      if (!isDbUnavailableError(dbError)) throw dbError;
      logger.warn({
        msg: "SyncedData: DB read/write blocked (plan hold) — serving API payload",
        cacheKey,
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
      mirrorWriteThrough(cacheKey, dataType, indexName, data, syncedAt, ttlSeconds);
      cache.set(memKey, { data, syncedAt }, ttlSeconds);
      return { data, source: "api", syncedAt, changed: false };
    }
  } catch (error) {
    logger.error({
      msg: "SyncedData: upstream fetch failed — falling back to DB",
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });

    // 3) DB fallback — only reached because memory was empty AND the API threw.
    let row: { data: unknown; lastSyncedAt: Date | null } | null = null;

    if (isPlanLimitBreakerOpen()) {
      // Hold-proof: zero Prisma ops — probe the SQLite mirror first (it was
      // backfilled before the hold or kept fresh by mirrorWriteThrough).
      row = mirrorReadMarketCache(cacheKey);
    } else {
      try {
        row = await prisma.marketCache.findUnique({ where: { cacheKey } });
      } catch (dbError) {
        if (!isDbUnavailableError(dbError)) throw dbError;
        logger.warn({
          msg: "SyncedData: DB fallback read blocked (plan hold) — trying SQLite mirror",
          cacheKey,
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
        row = mirrorReadMarketCache(cacheKey);
      }
    }

    if (row !== null && row.data != null) {
      const data = row.data as T;
      cache.set(memKey, { data, syncedAt: row.lastSyncedAt }, FALLBACK_MEM_TTL_SECONDS);
      return { data, source: "db", syncedAt: row.lastSyncedAt, changed: false };
    }

    // Nothing usable anywhere — surface the original failure.
    throw error;
  }
}