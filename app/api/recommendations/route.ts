// HOT ROUTE (Plan 09 Phase 8): read-first chain — route memory cache (60s
// ROUTE_CACHE_KEY) -> SQLite mirror while the plan-limit breaker is open ->
// Prisma with Accelerate cacheStrategy on the heavy latest-run reads.
import { NextRequest, NextResponse } from "next/server";
import {
  getLatestRecommendations,
  computeFreshnessFields,
  computeIsStale,
  RECOMMENDATION_CRON_DISPLAY,
} from "@/lib/services/dailyRecommendationService";
import { recommendationsCache } from "@/lib/cache";
import { isDbUnavailableError, isPlanLimitBreakerOpen } from "@/lib/db-utils";
import { getSqliteFallback } from "@/lib/sqlite";
import { recordRead } from "@/lib/services/readTier";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// Route-level memory cache. DISTINCT from the service's LATEST_KEY
// ("recommendations:latest"): writing the responseBody shape under the service
// key previously destroyed the service's LatestCacheEntry ({runId, newestRunId,
// data}) → the run-id fingerprint check always read cached.runId === undefined
// → the heavy stocks-include query ran on EVERY request (db-health 14/14
// huge-query misses). The key split fixes the collision; the read-first fast
// path below then serves the serialized payload from memory with ZERO Prisma
// reads for up to TTL seconds.
const ROUTE_CACHE_KEY = "recommendations:api:latest";
const ROUTE_CACHE_TTL_SECONDS = 60;

interface RouteRecommendationsCacheBody {
  success: boolean;
  run?: unknown;
  latestRun?: unknown;
  lastSuccessfulRunDate?: string | null;
  // Spec 30 freshness fields (additive; optional so a pre-upgrade cached body
  // still type-checks — the route backfills defaults where absent).
  nextRunAt?: string | null;
  lastUpdatedAt?: string | null;
  isStale?: boolean;
  scheduleCron?: string;
  stocks: unknown[];
  timestamp: string;
}

/**
 * Spec 30: contract-required defaults for degraded/fallback payloads — all four
 * freshness keys are ALWAYS present (values nullable). Used by the plan-limit
 * mirror path where a full `computeFreshnessFields()` (which reads Prisma) must
 * NOT run.
 */
const FRESHNESS_DEFAULTS = {
  nextRunAt: null as string | null,
  lastUpdatedAt: null as string | null,
  isStale: false,
  scheduleCron: RECOMMENDATION_CRON_DISPLAY,
};

/**
 * Spec 30 §10.6 / §13: on a route-cache hit, patch freshness from current time
 * without a DB read (O(1)). Only `isStale` can flip inside the 60s TTL, so it is
 * recomputed from the cached `lastUpdatedAt`; the state-derived `nextRunAt` /
 * `lastUpdatedAt` stay (≤60s staleness is acceptable, §16).
 */
function patchFreshness<T extends RouteRecommendationsCacheBody>(body: T): T {
  return {
    ...body,
    isStale: computeIsStale(body.lastUpdatedAt ?? null),
    timestamp: new Date().toISOString(),
  };
}

// GET /api/recommendations — Get latest daily recommendations
export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || "none";
  
  try {
    logger.info({ msg: "Fetching latest recommendations", requestId });

    // v3.23.x: during a plan-limit hold the Prisma account is unavailable —
    // serve the SQLite mirror directly WITHOUT attempting any Prisma call
    // (even a fast-fail breaker throw generates log noise). Prisma is only
    // touched again on the 6h recovery sync or a manual force.
    if (isPlanLimitBreakerOpen()) {
      const sqlite = getSqliteFallback();
      const cached = sqlite?.isReady() ? sqlite.getLatestRecommendations() : null;
      if (cached) {
        logger.warn({
          msg: "Recommendations: plan-limit breaker open — serving SQLite mirror",
          requestId,
        });
        return NextResponse.json({
          ...FRESHNESS_DEFAULTS,
          ...cached,
          timestamp: new Date().toISOString(),
          servedFrom: "sqlite_mirror",
        });
      }
      // No SQLite mirror yet — fall through to memory cache / Prisma attempt.
      const memCached = recommendationsCache.get<RouteRecommendationsCacheBody>(ROUTE_CACHE_KEY);
      if (memCached) {
        logger.warn({
          msg: "Recommendations: plan-limit breaker open — serving memory cache",
          requestId,
        });
        return NextResponse.json({ ...patchFreshness(memCached), servedFrom: "memory_cache" });
      }
    }

    // v3.28.4 — read-first fast path: the serialized payload was already
    // cached under the ROUTE-CONTAINED key in a prior request (60s TTL).
    // Serve it from memory WITHOUT touching the service's validated cache or
    // Prisma. This is the collision-fix companion: the previous code wrote the
    // responseBody under the service's "recommendations:latest" key, which
    // corrupted the service's LatestCacheEntry shape and forced the heavy
    // stocks-include query on EVERY request.
    const memCached = recommendationsCache.get<RouteRecommendationsCacheBody>(ROUTE_CACHE_KEY);
    if (memCached) {
      recordRead("recommendations.memory", {
        source: "memory",
        latencyMs: 0,
        rows: memCached.stocks.length,
        hit: true,
      });
      logger.debug({ msg: "Recommendations served from route memory cache" });
      return NextResponse.json({ ...patchFreshness(memCached), servedFrom: "memory_cache" });
    }

    const _recStart = performance.now();
    const { run, stocks, latestRun, lastSuccessfulRunDate } = await getLatestRecommendations();
    // Spec 30 §4C/§10.6: compute freshness BEFORE caching so a cached body never
    // carries stale info. computeFreshnessFields() never throws (defaults on any
    // failure), so a freshness problem can never 500 the reads.
    const freshness = await computeFreshnessFields();
    recordRead("recommendations.prisma", {
      source: "prisma",
      latencyMs: Math.max(0, Math.round(performance.now() - _recStart)),
      rows: stocks.length,
      hit: false,
    });

    logger.info({
      msg: "Recommendations fetched",
      stockCount: stocks.length,
      runId: run?.id,
    });

    // Serialize run safely — pick only scalar fields (avoid BigInt in nested stocks)
    const serializedRun = run
      ? {
          id: run.id,
          runDate: run.runDate instanceof Date ? run.runDate.toISOString() : String(run.runDate),
          status: run.status,
          totalScreeners: run.totalScreeners,
          uniqueStocks: run.uniqueStocks,
          aiProcessed: run.aiProcessed,
          executionTimeMs: run.executionTimeMs,
        }
      : null;

    // Newest run row (may be a v3.11.1 AI-unavailable failure with zero picks —
    // in that case `run` above is the last good run and the UI shows a notice).
    const serializedLatestRun = latestRun
      ? {
          id: latestRun.id,
          runDate:
            latestRun.runDate instanceof Date
              ? latestRun.runDate.toISOString()
              : String(latestRun.runDate),
          status: latestRun.status,
        }
      : null;

    // v3.49.0 (Spec 29): ISO date of the last COMPLETED run with AI verdicts.
    // Prefer `run.runDate` (the payload run IS the last successful run under
    // the new predicate); fall back to the service-level field (already an ISO
    // string set by getLatestRecommendations) when `run` is null.
    const serializedLastSuccessfulRunDate: string | null =
      serializedRun?.runDate ?? lastSuccessfulRunDate ?? null;

    // Serialize stocks — convert BigInt, ensure plain objects
    const serializedStocks = stocks.map((s) => ({
      symbol: s.symbol,
      price: s.price,
      change: s.change,
      changePercent: s.changePercent,
      volume: typeof s.volume === "bigint" ? Number(s.volume) : (s.volume ?? 0),
      screenerAttribution: s.screenerAttribution,
      screenerCount: s.screenerCount,
      aiRecommendation: s.aiRecommendation ?? "HOLD",
      confidence: s.confidence ?? 50,
      targetPrice: s.targetPrice ?? null,
      stopLoss: s.stopLoss ?? null,
      timeHorizon: s.timeHorizon ?? "medium",
      reasoning: s.reasoning ?? null,
      riskFactors: s.riskFactors ?? null,
      // Tracker status for highlighting
      trackerStatus: s.tracker?.status ?? "active",
      entryPrice: s.tracker?.entryPrice ?? s.price,
      currentPrice: s.tracker?.currentPrice ?? s.price,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    }));

    const responseBody = {
      success: true,
      run: serializedRun,
      latestRun: serializedLatestRun,
      lastSuccessfulRunDate: serializedLastSuccessfulRunDate,
      // Spec 30 freshness (additive; all four keys always present).
      ...freshness,
      stocks: serializedStocks,
      timestamp: new Date().toISOString(),
    };

    // Cache under the route-contained key (v3.28.4 — was "recommendations:latest",
    // which collided with the service's LATEST_KEY and destroyed its fingerprint)
    recommendationsCache.set(ROUTE_CACHE_KEY, responseBody, ROUTE_CACHE_TTL_SECONDS);

    // Background: sync to SQLite for future DB-outage fallback
    const sqlite = getSqliteFallback();
    if (sqlite?.isReady()) {
      sqlite.syncFromPrisma().catch(() => {}); // non-blocking
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    // --- SQLite fallback ---
    const sqlite = getSqliteFallback();
    if (sqlite?.isReady()) {
      try {
        const cached = sqlite.getLatestRecommendations();
        if (cached) {
          logger.warn({ msg: "Recommendations: DB unavailable — serving SQLite backup" });
          return NextResponse.json(cached);
        }
      } catch {
        // SQLite fallback itself failed — fall through to memory cache
      }
    }

    // --- Memory cache fallback (covers both DB + network errors) ---
    if (isDbUnavailableError(error)) {
      const memCached = recommendationsCache.get<RouteRecommendationsCacheBody>(ROUTE_CACHE_KEY);
      if (memCached) {
        logger.warn({ msg: "Recommendations: DB unavailable — serving memory cache" });
        return NextResponse.json(memCached);
      }
    }

    logger.error({
      msg: "Failed to fetch recommendations",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch recommendations" },
      { status: 500 }
    );
  }
}
