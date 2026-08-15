/**
 * Recommendation Performance Service (v3.5.0)
 *
 * Backs the public Performance tab on /recommendations:
 *   - getPerformanceList(): paginated, filterable list of recommendation trackers
 *     with computed return %, days tracked, and dynamic column metadata.
 *   - getPerformanceColumns(): column metadata the UI can toggle.
 *   - archiveRecommendations(): 360-day archival sweep — snapshots old trackers
 *     into RecommendationArchive then hard-deletes them (statusHistory survives
 *     as JSON inside the archive; daily_recommendation_stocks survive via
 *     trackerId SetNull).
 *
 * Lifecycle (locked decision): tracking → target_achieved / stop_loss_hit → archived.
 * There is NO 30-day expiry anymore. Archival is age ≥ 360 days ONLY; target/SL
 * hits are flags, not triggers (tracker stays visible until it ages out).
 *
 * @module recommendationPerformanceService
 * @version 3.5.0
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { recommendationsCache } from "@/lib/cache";
import { createAuditLog } from "@/lib/audit";

// ─── Constants ───────────────────────────────────────────────────────────

/** Days after which a tracker is archived (snapshot + hard-delete). */
export const ARCHIVE_AFTER_DAYS = 360;

/** Performance list cache TTL (15 min — prices update daily, no need for 23h). */
const PERFORMANCE_CACHE_TTL_SECONDS = 900;

const PERFORMANCE_CACHE_KEY = "recommendations:performance";

// ─── Types ───────────────────────────────────────────────────────────────

export interface PerformanceQuery {
  limit?: number;
  offset?: number;
  status?: string;
  category?: string; // btst | short | swing | medium | long
  recommendation?: string; // BUY | HOLD | SELL
  sort?:
    | "createdAt"
    | "returnPercent"
    | "symbol"
    | "confidence"
    | "entryPrice"
    | "currentPrice"
    | "targetPrice"
    | "stopLoss"
    | "daysTracked"
    | "lastCheckedAt";
  order?: "asc" | "desc";
}

export interface PerformanceListItem {
  id: string;
  symbol: string;
  status: string;
  category: string | null; // timeHorizon
  entryPrice: number;
  currentPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  returnPercent: number | null;
  daysTracked: number;
  aiRecommendation: string | null;
  confidence: number | null;
  reasoning: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface PerformanceColumn {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  align?: "left" | "right" | "center";
  defaultValue?: boolean; // whether the column is shown by default in the UI
  hint?: string;
}

export interface PerformanceListResponse {
  items: PerformanceListItem[];
  total: number;
  columns: PerformanceColumn[];
}

export interface ArchiveResult {
  archived: number;
  failed: number;
  executionTimeMs: number;
}

// ─── Column metadata (dynamic UI) ────────────────────────────────────────

export function getPerformanceColumns(): PerformanceColumn[] {
  return [
    { key: "symbol", label: "Symbol", sortable: true, defaultValue: true },
    { key: "status", label: "Status", filterable: true, defaultValue: true },
    { key: "category", label: "Category", filterable: true, defaultValue: true, hint: "btst | short | swing | medium | long" },
    { key: "entryPrice", label: "Entry", sortable: true, align: "right", defaultValue: true },
    { key: "currentPrice", label: "Current", sortable: true, align: "right", defaultValue: true },
    { key: "targetPrice", label: "Target", sortable: true, align: "right", defaultValue: true },
    { key: "stopLoss", label: "Stop Loss", sortable: true, align: "right", defaultValue: true },
    { key: "returnPercent", label: "Return %", sortable: true, align: "right", defaultValue: true },
    { key: "daysTracked", label: "Days Tracked", sortable: true, align: "right", defaultValue: false },
    { key: "aiRecommendation", label: "AI View", filterable: true, defaultValue: true },
    { key: "confidence", label: "Confidence", sortable: true, align: "right", defaultValue: true },
    { key: "reasoning", label: "AI Reasoning", defaultValue: false },
    { key: "lastCheckedAt", label: "Last Checked", sortable: true, align: "right", defaultValue: false },
    { key: "createdAt", label: "Recommended", sortable: true, align: "right", defaultValue: false },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function toListItem(t: {
  id: string;
  symbol: string;
  status: string;
  timeHorizon: string;
  entryPrice: number;
  currentPrice: number | null;
  targetPrice: number;
  stopLoss: number;
  aiRecommendation: string;
  confidence: number;
  reasoning: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
}): PerformanceListItem {
  const returnPercent =
    t.currentPrice != null
      ? ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100
      : null;
  const daysTracked = Math.max(
    1,
    Math.floor((Date.now() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  );

  return {
    id: t.id,
    symbol: t.symbol,
    status: t.status,
    category: t.timeHorizon ?? null,
    entryPrice: t.entryPrice,
    currentPrice: t.currentPrice,
    targetPrice: t.targetPrice,
    stopLoss: t.stopLoss,
    returnPercent: returnPercent != null ? Number(returnPercent.toFixed(2)) : null,
    daysTracked,
    aiRecommendation: t.aiRecommendation ?? null,
    confidence: t.confidence ?? null,
    reasoning: t.reasoning ?? null,
    lastCheckedAt: t.lastCheckedAt ? t.lastCheckedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

// ─── Public list (cached 15 min) ─────────────────────────────────────────

/**
 * Bridge trackers whose currentPrice is null with the latest close from
 * `daily_prices` (single batched DISTINCT ON query — no N+1). The 4PM IST
 * perf-check cron keeps currentPrice fresh for trackers, but newly settled
 * trackers or days without a run can lag; this guarantees the Current column
 * and Return % never show "—" while a daily_prices row exists.
 */
async function bridgeMissingCurrentPrices<T extends { symbol: string; currentPrice: number | null }>(
  rows: T[],
): Promise<T[]> {
  const missing = rows.filter((r) => r.currentPrice == null);
  if (missing.length === 0) return rows;

  const symbols = [...new Set(missing.map((r) => r.symbol))];
  try {
    const priceRows = await prisma.$queryRaw<{ ticker: string; close: number }[]>`
      SELECT DISTINCT ON (ticker) ticker, close::float8 as close
      FROM daily_prices
      WHERE ticker = ANY(${symbols})
      ORDER BY ticker, "tradeDate" DESC
    `;
    const priceMap = new Map(priceRows.map((p) => [p.ticker, p.close]));
    return rows.map((r) =>
      r.currentPrice == null && priceMap.has(r.symbol)
        ? { ...r, currentPrice: priceMap.get(r.symbol)! }
        : r,
    );
  } catch (error) {
    logger.warn({
      msg: "Current-price bridge failed for performance list",
      error: error instanceof Error ? error.message : String(error),
    });
    return rows;
  }
}

/**
 * Get the performance list of recommendation trackers.
 *
 * Only trackers created BEFORE today are shown ("next-day promotion") so the
 * Today's Picks tab keeps fresh picks and Performance holds settled trackers.
 * Results are cached 15 minutes; invalidate via {@link invalidateRecommendationsCache}.
 */
export async function getPerformanceList(query: PerformanceQuery = {}): Promise<PerformanceListResponse> {
  const {
    limit = 50,
    offset = 0,
    status,
    category,
    recommendation,
    sort = "createdAt",
    order = "desc",
  } = query;

  const cacheKey = `${PERFORMANCE_CACHE_KEY}:${limit}:${offset}:${status ?? "*"}:${category ?? "*"}:${recommendation ?? "*"}:${sort}:${order}`;
  const cached = recommendationsCache.get<PerformanceListResponse>(cacheKey);
  if (cached) {
    return cached;
  }

  // Start of today — exclude trackers created today (next-day promotion)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = {
    createdAt: { lt: todayStart },
  };
  if (status) where.status = status;
  if (category) where.timeHorizon = category;
  if (recommendation) where.aiRecommendation = recommendation;

  const orderBy: Record<string, "asc" | "desc"> = {};
  if (sort === "returnPercent") {
    // Return % is computed, not stored — sort in JS below instead. To keep
    // pagination correct (page 1 = true top returners) we fetch ALL matching
    // trackers (bounded, next-day-promoted, cached 15 min) then sort + slice.
    orderBy.createdAt = order;
  } else if (sort === "daysTracked") {
    // daysTracked = floor((now - createdAt)/day)+1 is INVERSE-monotonic with
    // createdAt (newer createdAt ⇒ smaller daysTracked) — flip the direction
    // so the stored field yields the requested daysTracked order exactly.
    orderBy.createdAt = order === "asc" ? "desc" : "asc";
  } else {
    orderBy[sort] = order;
  }

  const total = await prisma.recommendationTracker.count({ where });

  if (sort === "returnPercent") {
    const all = await prisma.recommendationTracker.findMany({
      where,
      orderBy,
      take: 5000, // safety bound; cache makes re-fetch cheap
    });
    const bridged = await bridgeMissingCurrentPrices(all);
    const allItems = bridged.map(toListItem);
    allItems.sort((a, b) => {
      const av = a.returnPercent ?? -Infinity;
      const bv = b.returnPercent ?? -Infinity;
      return order === "desc" ? bv - av : av - bv;
    });
    const items = allItems.slice(offset, offset + Math.min(limit, 200));

    const response: PerformanceListResponse = {
      items,
      total,
      columns: getPerformanceColumns(),
    };
    recommendationsCache.set(cacheKey, response, PERFORMANCE_CACHE_TTL_SECONDS);
    return response;
  }

  const rows = await prisma.recommendationTracker.findMany({
    where,
    orderBy,
    take: Math.min(limit, 200),
    skip: offset,
  });

  const bridged = await bridgeMissingCurrentPrices(rows);
  const items = bridged.map(toListItem);

  const response: PerformanceListResponse = {
    items,
    total,
    columns: getPerformanceColumns(),
  };

  recommendationsCache.set(cacheKey, response, PERFORMANCE_CACHE_TTL_SECONDS);
  return response;
}

// ─── 360-day archival sweep ──────────────────────────────────────────────

/**
 * Archive trackers older than 360 days.
 *
 * For each eligible tracker:
 *   1. Load its full statusHistory (will be cascade-deleted on tracker delete).
 *   2. Snapshot everything into RecommendationArchive (statusHistory as JSON).
 *   3. Hard-delete the tracker. daily_recommendation_stocks survive (SetNull),
 *      and the run data remains untouched.
 *
 * Idempotent: skips trackers already archived (defensive check on trackerId).
 * Uses runInChunks (bounded concurrency) — NEVER an interactive $transaction
 * (5s interactive-transaction timeout).
 */
export async function archiveRecommendations(): Promise<ArchiveResult> {
  const startTime = Date.now();
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const eligible = await prisma.recommendationTracker.findMany({
    where: { createdAt: { lte: cutoff } },
    take: 500, // bound each sweep
  });

  if (eligible.length === 0) {
    logger.info({ msg: "Recommendation archival sweep: nothing to archive" });
    return { archived: 0, failed: 0, executionTimeMs: 0 };
  }

  // Idempotency: skip trackerIds already snapshotted (crash-recovery safety)
  const existingArchives = await prisma.recommendationArchive.findMany({
    where: { trackerId: { in: eligible.map((e) => e.id) } },
    select: { trackerId: true },
  });
  const archivedSet = new Set(existingArchives.map((a) => a.trackerId));
  const toArchive = eligible.filter((t) => !archivedSet.has(t.id));

  let archived = 0;
  let failed = 0;

  // Batch snapshot + delete per tracker; bounded concurrency via runInChunks
  const ops = toArchive.map((tracker) => async () => {
    try {
      const history = await prisma.recommendationStatusHistory.findMany({
        where: { trackerId: tracker.id },
        orderBy: { createdAt: "asc" },
      });

      const daysTracked = Math.max(
        1,
        Math.floor((Date.now() - tracker.createdAt.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      );
      const returnPercent =
        tracker.currentPrice != null
          ? ((tracker.currentPrice - tracker.entryPrice) / tracker.entryPrice) * 100
          : null;

      await prisma.recommendationArchive.create({
        data: {
          symbol: tracker.symbol,
          trackerId: tracker.id,
          runDate: tracker.createdAt,
          entryPrice: tracker.entryPrice,
          currentPrice: tracker.currentPrice,
          targetPrice: tracker.targetPrice,
          stopLoss: tracker.stopLoss,
          category: tracker.timeHorizon ?? null,
          aiRecommendation: tracker.aiRecommendation ?? null,
          confidence: tracker.confidence ?? null,
          reasoning: tracker.reasoning ?? null,
          riskFactors: (tracker.riskFactors as never) ?? undefined,
          screenerAttribution: (tracker.screenerAttribution as never) ?? undefined,
          finalStatus: tracker.status,
          returnPercent: returnPercent != null ? Number(returnPercent.toFixed(2)) : null,
          daysTracked,
          statusHistory: history.map((h) => ({
            previousStatus: h.previousStatus,
            newStatus: h.newStatus,
            triggerSource: h.triggerSource,
            metadata: h.metadata,
            createdAt: h.createdAt.toISOString(),
          })),
          archivedReason: "age_360d",
        },
      });

      // Hard-delete tracker (statusHistory cascade-deletes; dailyStocks SetNull)
      await prisma.recommendationTracker.delete({ where: { id: tracker.id } });

      await createAuditLog({
        action: "RECOMMENDATION_ARCHIVED",
        resource: "recommendation_tracker",
        resourceId: tracker.id,
        metadata: {
          symbol: tracker.symbol,
          finalStatus: tracker.status,
          daysTracked,
          returnPercent,
          reason: "age_360d",
        },
      });

      archived++;
    } catch (error) {
      failed++;
      logger.error({
        msg: "Failed to archive recommendation tracker",
        trackerId: tracker.id,
        symbol: tracker.symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await runInChunks(ops, 10, (chunk) => Promise.all(chunk.map((op) => op())));

  invalidateRecommendationsCache();

  const executionMs = Date.now() - startTime;
  logger.info({ msg: "Recommendation archival sweep completed", archived, failed, executionTimeMs: executionMs });

  return { archived, failed, executionTimeMs: executionMs };
}

/** Invalidate the performance list cache (called after any tracker write). */
export function invalidateRecommendationsCache(): void {
  for (const key of recommendationsCache.keys()) {
    if (key.startsWith(PERFORMANCE_CACHE_KEY)) {
      recommendationsCache.del(key);
    }
  }
  // Also clear the Today's Picks + history caches (same NodeCache instance)
  recommendationsCache.flushAll();
  logger.debug({ msg: "Recommendations caches invalidated" });
}

// ─── runInChunks (bounded concurrency, mirrors dailyRecommendationService) ─

async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await fn(items.slice(i, i + chunkSize));
  }
}
