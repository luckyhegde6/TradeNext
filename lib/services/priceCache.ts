/**
 * Price Cache — In-memory store for latest stock prices.
 *
 * Used by the SSE price sync service to cache the most recent price
 * for each symbol. Data is available immediately on page load before
 * the first SSE update arrives.
 *
 * TTL-based expiry with configurable max age.
 * Falls back gracefully (returns null) when no data is cached.
 */

type PriceData = {
  price: number;
  change: number;
  changePercent: number;
  timestamp: number; // ms since epoch
};

type Callback = (symbol: string, data: PriceData) => void;

class PriceCache {
  private cache = new Map<string, PriceData>();
  private subscribers = new Map<string, Set<Callback>>();
  private defaultTTL = 30_000; // 30 seconds

  /**
   * Get cached price for a symbol.
   */
  get(symbol: string): PriceData | null {
    const data = this.cache.get(symbol.toUpperCase());
    if (!data) return null;
    if (Date.now() - data.timestamp > this.defaultTTL) {
      this.cache.delete(symbol.toUpperCase());
      return null;
    }
    return data;
  }

  /**
   * Set cached price for a symbol.
   */
  set(symbol: string, data: PriceData): void {
    this.cache.set(symbol.toUpperCase(), { ...data, timestamp: Date.now() });
  }

  /**
   * Subscribe to price updates for a symbol.
   * Returns unsubscribe function.
   */
  subscribe(symbol: string, callback: Callback): () => void {
    const sym = symbol.toUpperCase();
    if (!this.subscribers.has(sym)) {
      this.subscribers.set(sym, new Set());
    }
    this.subscribers.get(sym)!.add(callback);
    return () => {
      this.subscribers.get(sym)?.delete(callback);
      if (this.subscribers.get(sym)?.size === 0) {
        this.subscribers.delete(sym);
      }
    };
  }

  /**
   * Notify all subscribers of a price update.
   */
  notify(symbol: string, data: PriceData): void {
    this.set(symbol, data);
    const sym = symbol.toUpperCase();
    const subs = this.subscribers.get(sym);
    if (subs) {
      for (const cb of subs) {
        try { cb(sym, data); } catch { /* ignore subscriber error */ }
      }
    }
  }

  /**
   * Get all cached symbols and their prices.
   */
  getAll(): Record<string, PriceData> {
    const result: Record<string, PriceData> = {};
    for (const [symbol, data] of this.cache.entries()) {
      if (Date.now() - data.timestamp <= this.defaultTTL) {
        result[symbol] = data;
      }
    }
    return result;
  }

  /**
   * Get stats about cached prices.
   */
  getStats(): { cachedSymbols: number; activeSubscriptions: number } {
    return {
      cachedSymbols: this.cache.size,
      activeSubscriptions: this.subscribers.size,
    };
  }
}

// Singleton
export const priceCache = new PriceCache();
