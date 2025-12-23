// Enhanced caching system with polling and intelligent cache management
import cache, { hotCache, staticCache } from "@/lib/cache";
import logger from "@/lib/logger";
import { isMarketOpen, getRecommendedTTL } from "@/lib/market-hours";

interface CacheConfig {
  key: string;
  ttl: number;
  cacheInstance?: typeof cache | typeof hotCache | typeof staticCache;
  forceRefresh?: boolean;
}

interface PollingConfig {
  interval: number; // milliseconds
  maxAge: number; // maximum age before forcing refresh
  retryAttempts: number;
  backoffMultiplier: number;
}

class EnhancedCacheManager {
  private pollingTimers = new Map<string, NodeJS.Timeout>();
  private pollingConfigs = new Map<string, PollingConfig>();
  private cacheTimestamps = new Map<string, number>();

  /**
   * Get data with intelligent caching and optional polling
   */
  async getWithCache<T>(
    config: CacheConfig,
    fetchFn: () => Promise<T>,
    pollingConfig?: PollingConfig
  ): Promise<T> {
    const { key, ttl, cacheInstance = cache, forceRefresh = false } = config;

    // Check cache first unless force refresh
    if (!forceRefresh) {
      const cached = cacheInstance.get(key);
      if (cached !== undefined) {
        logger.debug({ msg: 'Cache hit', key });
        return cached as T;
      }
    }

    // Fetch fresh data
    logger.debug({ msg: 'Cache miss, fetching fresh data', key });
    const data = await fetchFn();

    // Cache the result with market-aware TTL
    const recommendedTtl = getRecommendedTTL(ttl);
    cacheInstance.set(key, data, recommendedTtl);
    logger.debug({ msg: 'Data cached', key, ttl: recommendedTtl, marketOpen: isMarketOpen() });

    // Set up polling if configured
    if (pollingConfig) {
      this.setupPolling(key, config, fetchFn, pollingConfig);
    }

    return data;
  }

  /**
   * Set up polling for a cache key
   */
  private setupPolling<T>(
    key: string,
    cacheConfig: CacheConfig,
    fetchFn: () => Promise<T>,
    pollingConfig: PollingConfig
  ): void {
    // Clear existing timer
    const existingTimer = this.pollingTimers.get(key);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    this.pollingConfigs.set(key, pollingConfig);

    const timer = setInterval(async () => {
      try {
        const config = this.pollingConfigs.get(key);
        if (!config) return;

        // SKIP polling if market is closed to avoid unnecessary API calls
        if (!isMarketOpen()) {
          logger.debug({ msg: 'Market closed, skipping polling refresh', key });
          return;
        }

        // Check if data is still fresh enough
        const cached = cacheConfig.cacheInstance?.get(key);
        if (cached && (Date.now() - this.getCacheTimestamp(key) < config.maxAge)) {
          return; // Data still fresh
        }

        logger.debug({ msg: 'Polling refresh', key });
        const data = await this.fetchWithRetry(fetchFn, config.retryAttempts, config.backoffMultiplier);

        const recommendedTtl = getRecommendedTTL(cacheConfig.ttl);
        cacheConfig.cacheInstance?.set(key, data, recommendedTtl);
        this.updateCacheTimestamp(key);

      } catch (error) {
        logger.warn({ msg: 'Polling refresh failed', key, error: error instanceof Error ? error.message : String(error) });
      }
    }, pollingConfig.interval);

    this.pollingTimers.set(key, timer);
    logger.info({ msg: 'Polling setup', key, interval: pollingConfig.interval });
  }

  /**
   * Fetch with retry logic and exponential backoff
   */
  private async fetchWithRetry<T>(
    fetchFn: () => Promise<T>,
    maxAttempts: number,
    backoffMultiplier: number
  ): Promise<T> {
    let attempt = 0;
    let delay = 1000; // Start with 1 second

    while (attempt < maxAttempts) {
      try {
        return await fetchFn();
      } catch (error) {
        attempt++;
        if (attempt >= maxAttempts) {
          throw error;
        }

        logger.warn({
          msg: 'Fetch attempt failed, retrying',
          attempt,
          maxAttempts,
          delay,
          error: error instanceof Error ? error.message : String(error)
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= backoffMultiplier;
      }
    }

    throw new Error('Max retry attempts exceeded');
  }

  /**
   * Stop polling for a specific key
   */
  stopPolling(pollingKey: string): void {
    const timer = this.pollingTimers.get(pollingKey);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(pollingKey);
      this.pollingConfigs.delete(pollingKey);
      logger.info({ msg: 'Polling stopped', key: pollingKey });
    }
  }

  /**
   * Stop all polling
   */
  stopAllPolling(): void {
    for (const [key, timer] of this.pollingTimers) {
      clearInterval(timer);
      logger.info({ msg: 'Polling stopped', key });
    }
    this.pollingTimers.clear();
    this.pollingConfigs.clear();
  }


  /**
   * Invalidate cache and stop polling
   */
  invalidate(cacheKey: string): void {
    cache.del(cacheKey);
    hotCache.del(cacheKey);
    staticCache.del(cacheKey);
    this.stopPolling(cacheKey);
    logger.info({ msg: 'Cache invalidated', key: cacheKey });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      polling: {
        activeKeys: Array.from(this.pollingTimers.keys()),
        configs: Object.fromEntries(this.pollingConfigs)
      }
    };
  }

  /**
   * Get cache timestamp for a key
   */
  private getCacheTimestamp(key: string): number {
    return this.cacheTimestamps.get(key) || 0;
  }

  /**
   * Update cache timestamp for a key
   */
  private updateCacheTimestamp(key: string): void {
    this.cacheTimestamps.set(key, Date.now());
  }
}

// Singleton instance
export const enhancedCache = new EnhancedCacheManager();

// Utility functions for common NSE data caching patterns
export const nseCache = {
  // Stock quotes - hot cache with polling
  stockQuote: (symbol: string) => ({
    key: `nse:stock:${symbol}:quote`,
    ttl: 120000, // 2 minutes
    cacheInstance: hotCache,
    pollingConfig: {
      interval: 30000, // 30 seconds
      maxAge: 60000, // 1 minute
      retryAttempts: 3,
      backoffMultiplier: 2
    } as PollingConfig
  }),

  // Stock charts - regular cache
  stockChart: (symbol: string, days: string) => ({
    key: `nse:stock:${symbol}:chart:${days}`,
    ttl: 300000, // 5 minutes
    cacheInstance: cache
  }),

  // Index data - hot cache with polling
  indexQuote: (indexName: string) => ({
    key: `nse:index:${indexName}:quote`,
    ttl: 120000, // 2 minutes
    cacheInstance: hotCache,
    pollingConfig: {
      interval: 15000, // 15 seconds for indices
      maxAge: 30000, // 30 seconds
      retryAttempts: 3,
      backoffMultiplier: 2
    } as PollingConfig
  }),

  // Static data - long TTL
  static: (key: string) => ({
    key: `nse:static:${key}`,
    ttl: 3600000, // 1 hour
    cacheInstance: staticCache
  }),

  // Corporate data - 1 hour TTL
  corporate: (symbol: string, type: string) => ({
    key: `nse:stock:${symbol}:corporate:${type}`,
    ttl: 3600000, // 1 hour
    cacheInstance: cache
  })
};

// Market data polling manager
export class MarketDataPoller {
  private static instance: MarketDataPoller;
  private activePolling = new Set<string>();

  static getInstance(): MarketDataPoller {
    if (!MarketDataPoller.instance) {
      MarketDataPoller.instance = new MarketDataPoller();
    }
    return MarketDataPoller.instance;
  }

  startPolling(symbol: string, type: 'stock' | 'index' = 'stock'): void {
    const key = `${type}:${symbol}`;
    if (this.activePolling.has(key)) return;

    this.activePolling.add(key);
    logger.info({ msg: 'Started market data polling', symbol, type });
  }

  stopPolling(symbol: string, type: 'stock' | 'index' = 'stock'): void {
    const key = `${type}:${symbol}`;
    if (!this.activePolling.has(key)) return;

    this.activePolling.delete(key);
    enhancedCache.stopPolling(`nse:${key}:quote`);
    logger.info({ msg: 'Stopped market data polling', symbol, type });
  }

  stopAllPolling(): void {
    for (const key of this.activePolling) {
      enhancedCache.stopPolling(`nse:${key}:quote`);
    }
    this.activePolling.clear();
    logger.info({ msg: 'Stopped all market data polling' });
  }

  getActivePolling(): string[] {
    return Array.from(this.activePolling);
  }
}

export const marketDataPoller = MarketDataPoller.getInstance();
