// lib/services/intelligence/cache.ts — Write-through dual-layer intelligence cache
// Layer 1: In-memory NodeCache (~1ms reads)
// Layer 2: Prisma IntelligenceCache (persistent, survives restarts)

import NodeCache from "node-cache";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import type { IntelligenceReport } from "../intelligenceTypes";
import { Prisma } from "@prisma/client";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ─── In-Memory Layer ─────────────────────────────────────────────────────────

const memoryCache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 300, // check for expired keys every 5 min
  useClones: false, // return references (faster, no serialization cost)
});

// ─── Core Cache Operations ───────────────────────────────────────────────────

/**
 * Get intelligence from cache (memory-first, DB fallback → restore to memory).
 */
export async function getIntelligenceFromCache(
  symbol: string
): Promise<{ report: IntelligenceReport; modelUsed: string | null; generatedAt: Date } | null> {
  const key = symbol.toUpperCase();

  // Layer 1: memory hit
  const memHit = memoryCache.get<{
    report: IntelligenceReport;
    modelUsed: string | null;
    generatedAt: Date;
  }>(key);
  if (memHit) {
    logger.debug({ msg: "Intelligence cache hit (memory)", symbol: key });
    return memHit;
  }

  // Layer 2: DB hit → restore to memory
  try {
    const dbRow = await prisma.intelligenceCache.findUnique({
      where: { symbol: key },
    });

    if (!dbRow) return null;

    // Check TTL
    if (dbRow.expiresAt < new Date()) {
      // Expired — delete from DB
      await prisma.intelligenceCache.delete({ where: { symbol: key } }).catch(() => {});
      return null;
    }

    const report = dbRow.data as unknown as IntelligenceReport;
    const entry = {
      report,
      modelUsed: dbRow.modelUsed,
      generatedAt: dbRow.generatedAt,
    };

    // Restore to memory
    const ttlSeconds = Math.max(1, Math.floor((dbRow.expiresAt.getTime() - Date.now()) / 1000));
    memoryCache.set(key, entry, ttlSeconds);

    logger.debug({ msg: "Intelligence cache hit (DB → memory)", symbol: key });
    return entry;
  } catch (err) {
    logger.error({
      msg: "Intelligence cache DB read failed",
      symbol: key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Write-through: upsert both DB + memory.
 */
export async function setIntelligenceCache(
  symbol: string,
  report: IntelligenceReport,
  modelUsed: string | null
): Promise<void> {
  const key = symbol.toUpperCase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_SECONDS * 1000);

  // Serialize once for DB (Prisma JSON requires InputJsonValue)
  const serializedReport = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;

  const entry = { report, modelUsed, generatedAt: now };

  // Write to memory immediately
  memoryCache.set(key, entry, CACHE_TTL_SECONDS);

  // Write to DB (fire-and-forget, don't block the response)
  prisma.intelligenceCache
    .upsert({
      where: { symbol: key },
      create: {
        symbol: key,
        data: serializedReport as unknown as Prisma.InputJsonValue,
        modelUsed,
        generatedAt: now,
        expiresAt,
      },
      update: {
        data: serializedReport as unknown as Prisma.InputJsonValue,
        modelUsed,
        generatedAt: now,
        expiresAt,
      },
    })
    .catch((err: unknown) => {
      logger.error({
        msg: "Intelligence cache DB write failed",
        symbol: key,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Invalidate cache for a symbol (both layers).
 */
export async function invalidateIntelligenceCache(symbol: string): Promise<void> {
  const key = symbol.toUpperCase();
  memoryCache.del(key);

  try {
    await prisma.intelligenceCache.delete({ where: { symbol: key } }).catch(() => {});
  } catch {
    // Ignore — may not exist
  }
}

/**
 * Bulk-load all non-expired entries from DB into memory at server startup.
 */
export async function restoreIntelligenceCacheFromDB(): Promise<number> {
  try {
    const rows = await prisma.intelligenceCache.findMany({
      where: { expiresAt: { gt: new Date() } },
    });

    let restored = 0;
    for (const row of rows) {
      const report = row.data as unknown as IntelligenceReport;
      const ttlSeconds = Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000));
      memoryCache.set(
        row.symbol,
        { report, modelUsed: row.modelUsed, generatedAt: row.generatedAt },
        ttlSeconds
      );
      restored++;
    }

    logger.info({ msg: "Intelligence cache restored from DB", count: restored });
    return restored;
  } catch (err) {
    logger.error({
      msg: "Intelligence cache restore failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Cache stats for admin monitoring.
 */
export async function getIntelligenceCacheStats(): Promise<{
  total: number;
  active: number;
  expired: number;
}> {
  try {
    const now = new Date();
    const [total, active] = await Promise.all([
      prisma.intelligenceCache.count(),
      prisma.intelligenceCache.count({ where: { expiresAt: { gt: now } } }),
    ]);
    return { total, active, expired: total - active };
  } catch {
    return { total: 0, active: 0, expired: 0 };
  }
}

/**
 * Reset cache state (test helper only).
 */
export function resetIntelligenceCacheForTests(): void {
  memoryCache.flushAll();
}
