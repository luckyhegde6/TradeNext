// lib/market-cache.ts - Smart caching service for NSE data
import prisma from "@/lib/prisma";
import { isMarketOpen, getMillisecondsUntilNextMarketOpen, getRecommendedTTL } from "@/lib/market-hours";
import logger from "@/lib/logger";

export type DataType = 
  | "corporate_actions" 
  | "announcements" 
  | "insider_trading" 
  | "block_deals" 
  | "bulk_deals" 
  | "short_selling" 
  | "gainers" 
  | "losers" 
  | "most_active"
  | "advance_decline"
  | "corporate_events"
  | "financial_results";

interface CacheOptions {
  dataType: DataType;
  indexName?: string;
  nseLastModified?: Date | null;
  ttlSecondsOpen?: number;  // TTL when market is open
  ttlSecondsClosed?: number; // TTL when market is closed
}

interface GetOrFetchResult<T> {
  data: T;
  source: "nse" | "db" | "cache";
  needsRefresh: boolean;
  lastSyncedAt: Date | null;
}

/**
 * Generate a unique cache key for the data type and index
 */
export function generateCacheKey(dataType: DataType, indexName?: string): string {
  if (indexName) {
    return `${dataType}_${indexName.replace(/\s+/g, "_").toUpperCase()}`;
  }
  return dataType;
}

/**
 * Calculate the next sync time based on market status
 */
function calculateNextSync(marketOpen: boolean, ttlSecondsOpen: number, ttlSecondsClosed: number): Date {
  const now = new Date();
  const ttl = marketOpen ? ttlSecondsOpen : ttlSecondsClosed;
  
  // If market is open, sync more frequently
  // If market is closed, sync next time market opens
  if (marketOpen) {
    return new Date(now.getTime() + ttlSecondsOpen * 1000);
  } else {
    // Return time until next market open
    const msUntilOpen = getMillisecondsUntilNextMarketOpen();
    return new Date(now.getTime() + msUntilOpen);
  }
}

/**
 * Check if cache needs refresh based on market hours
 */
export function needsCacheRefresh(
  lastSyncedAt: Date | null, 
  nextSyncAt: Date | null, 
  marketOpen: boolean
): boolean {
  const now = new Date();
  
  // No cache exists
  if (!lastSyncedAt) return true;
  
  // Next sync time is set and has passed
  if (nextSyncAt && now >= nextSyncAt) return true;
  
  // Market just opened - refresh if last sync was before market opened today
  if (marketOpen) {
    const today = now.toISOString().split("T")[0];
    const lastSyncDate = lastSyncedAt.toISOString().split("T")[0];
    
    // If last sync was yesterday or earlier, refresh
    if (lastSyncDate < today) return true;
  }
  
  return false;
}

/**
 * Get cached data or fetch from NSE if needed
 * This is the main entry point for smart caching
 */
export async function getOrFetchNseData<T>(
  fetchFromNse: () => Promise<T>,
  options: CacheOptions
): Promise<GetOrFetchResult<T>> {
  const { dataType, indexName, nseLastModified, ttlSecondsOpen = 300, ttlSecondsClosed = 3600 } = options;
  
  const cacheKey = generateCacheKey(dataType, indexName);
  const marketOpen = isMarketOpen();
  
  try {
    // Try to get existing cache
    const cached = await prisma.marketCache.findUnique({
      where: { cacheKey }
    });
    
    const lastSyncedAt = cached?.lastSyncedAt || null;
    const nextSyncAt = cached?.nextSyncAt || null;
    
    // Check if we need to refresh
    const shouldRefresh = needsCacheRefresh(lastSyncedAt, nextSyncAt, marketOpen);
    
    if (!shouldRefresh && cached) {
      logger.debug({ 
        msg: "MarketCache: Serving from DB", 
        cacheKey, 
        lastSyncedAt,
        marketOpen 
      });
      
      return {
        data: cached.data as T,
        source: "db",
        needsRefresh: false,
        lastSyncedAt
      };
    }
    
    // Need to refresh - fetch from NSE
    logger.info({ 
      msg: "MarketCache: Fetching from NSE", 
      cacheKey, 
      marketOpen,
      reason: !cached ? "no_cache" : "needs_refresh"
    });
    
    try {
      const nseData = await fetchFromNse();
      
      // Calculate next sync time
      const nextSync = calculateNextSync(marketOpen, ttlSecondsOpen, ttlSecondsClosed);
      
      // Upsert the cache
      const updatedCache = await prisma.marketCache.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          dataType,
          indexName: indexName || null,
          data: nseData as any,
          recordCount: Array.isArray(nseData) ? nseData.length : 1,
          nseLastModified: nseLastModified || null,
          lastSyncedAt: new Date(),
          nextSyncAt: nextSync,
          marketStatus: marketOpen ? "open" : "closed",
          syncStatus: "idle"
        },
        update: {
          data: nseData as any,
          recordCount: Array.isArray(nseData) ? nseData.length : 1,
          nseLastModified: nseLastModified || undefined,
          lastSyncedAt: new Date(),
          nextSyncAt: nextSync,
          marketStatus: marketOpen ? "open" : "closed",
          syncStatus: "idle",
          syncError: null
        }
      });
      
      return {
        data: nseData as T,
        source: "nse",
        needsRefresh: false,
        lastSyncedAt: updatedCache.lastSyncedAt
      };
    } catch (nseError) {
      logger.error({ 
        msg: "MarketCache: NSE fetch failed, serving from DB if available", 
        cacheKey, 
        error: nseError 
      });
      
      // If NSE fails but we have cached data, return it
      if (cached) {
        return {
          data: cached.data as T,
          source: "db",
          needsRefresh: true,
          lastSyncedAt: cached.lastSyncedAt
        };
      }
      
      // No cache and NSE failed - rethrow
      throw nseError;
    }
  } catch (error) {
    logger.error({ 
      msg: "MarketCache: Error in getOrFetch", 
      cacheKey, 
      error 
    });
    throw error;
  }
}

/**
 * Force refresh cache from NSE
 */
export async function forceRefreshCache<T>(
  fetchFromNse: () => Promise<T>,
  dataType: DataType,
  indexName?: string,
  nseLastModified?: Date | null
): Promise<GetOrFetchResult<T>> {
  const cacheKey = generateCacheKey(dataType, indexName);
  const marketOpen = isMarketOpen();
  
  logger.info({ msg: "MarketCache: Force refreshing", cacheKey });
  
  const nseData = await fetchFromNse();
  const nextSync = calculateNextSync(marketOpen, 300, 3600);
  
  const updatedCache = await prisma.marketCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      dataType,
      indexName: indexName || null,
      data: nseData as any,
      recordCount: Array.isArray(nseData) ? nseData.length : 1,
      nseLastModified: nseLastModified || null,
      lastSyncedAt: new Date(),
      nextSyncAt: nextSync,
      marketStatus: marketOpen ? "open" : "closed",
      syncStatus: "idle"
    },
    update: {
      data: nseData as any,
      recordCount: Array.isArray(nseData) ? nseData.length : 1,
      nseLastModified: nseLastModified || undefined,
      lastSyncedAt: new Date(),
      nextSyncAt: nextSync,
      marketStatus: marketOpen ? "open" : "closed",
      syncStatus: "idle",
      syncError: null
    }
  });
  
  return {
    data: nseData as T,
    source: "nse",
    needsRefresh: false,
    lastSyncedAt: updatedCache.lastSyncedAt
  };
}

/**
 * Get cache status for monitoring
 */
export async function getCacheStatus(dataType?: DataType): Promise<any> {
  const where = dataType ? { dataType } : {};
  
  const caches = await prisma.marketCache.findMany({
    where,
    orderBy: { lastSyncedAt: "desc" }
  });
  
  return caches.map(c => ({
    cacheKey: c.cacheKey,
    dataType: c.dataType,
    indexName: c.indexName,
    recordCount: c.recordCount,
    lastSyncedAt: c.lastSyncedAt,
    nextSyncAt: c.nextSyncAt,
    marketStatus: c.marketStatus,
    syncStatus: c.syncStatus
  }));
}

/**
 * Clear specific cache or all caches
 */
export async function clearCache(cacheKey?: string, dataType?: DataType): Promise<number> {
  if (cacheKey) {
    await prisma.marketCache.delete({ where: { cacheKey } });
    return 1;
  }
  
  if (dataType) {
    const result = await prisma.marketCache.deleteMany({ where: { dataType } });
    return result.count;
  }
  
  // Clear all
  const result = await prisma.marketCache.deleteMany({});
  return result.count;
}
