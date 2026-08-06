/**
 * Price Sync Service — Polls NSE/TradingView for stock prices and
 * broadcasts updates via EventEmitter for SSE delivery.
 *
 * Architecture:
 *   Client connects → SSE endpoint registers symbols →
 *   PriceSyncService polls NSE at configurable intervals →
 *   Emits 'price' events → SSE endpoint writes to connection
 *
 * Market-aware: reduces poll frequency when market is closed.
 */

import { EventEmitter } from "events";
import logger from "@/lib/logger";
import { getStockQuote } from "@/lib/stock-service";
import { priceCache } from "./priceCache";
import { isMarketOpen } from "@/lib/market-hours";

/* ─── Types ─── */

export interface LivePriceEvent {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  volume: number;
  timestamp: string;
}

export interface SSEStats {
  connectedClients: number;
  symbolsTracked: number;
  cachedSymbols: number;
  activeSubscriptions: number;
  pollInterval: number;
  isMarketOpen: boolean;
  uptime: number;
}

/* ─── Constants ─── */

const POLL_INTERVAL_MS = 10_000;       // 10s during market hours
const POLL_INTERVAL_CLOSED_MS = 60_000; // 60s when market is closed
const BATCH_LIMIT = 50;                 // max symbols per client
const HEARTBEAT_INTERVAL_MS = 15_000;   // 15s heartbeat

/* ─── SSE Event Bus ─── */

class PriceEventBus extends EventEmitter {
  private trackedSymbols = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private clientCount = 0;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Start price polling and heartbeats.
   */
  start(): void {
    if (this.pollTimer) return;
    this.startPolling();
    this.startHeartbeat();
    logger.info({ msg: "Price sync service started", pollIntervalMs: POLL_INTERVAL_MS });
  }

  /**
   * Stop price polling and heartbeats.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    logger.info({ msg: "Price sync service stopped" });
  }

  /**
   * Register symbols to track.
   */
  addSymbols(symbols: string[]): void {
    for (const s of symbols) {
      this.trackedSymbols.add(s.toUpperCase());
    }
  }

  /**
   * Unregister symbols (on client disconnect).
   */
  removeSymbols(symbols: string[]): void {
    for (const s of symbols) {
      this.trackedSymbols.delete(s.toUpperCase());
    }
  }

  /**
   * Get all tracked symbols.
   */
  getTrackedSymbols(): string[] {
    return Array.from(this.trackedSymbols);
  }

  /**
   * Increment connected client count.
   */
  addClient(): void {
    this.clientCount++;
  }

  /**
   * Decrement connected client count.
   */
  removeClient(): void {
    this.clientCount = Math.max(0, this.clientCount - 1);
    if (this.clientCount === 0) {
      this.trackedSymbols.clear();
    }
  }

  /**
   * Get current SSE stats.
   */
  getStats(): SSEStats {
    return {
      connectedClients: this.clientCount,
      symbolsTracked: this.trackedSymbols.size,
      cachedSymbols: priceCache.getStats().cachedSymbols,
      activeSubscriptions: priceCache.getStats().activeSubscriptions,
      pollInterval: isMarketOpen() ? POLL_INTERVAL_MS : POLL_INTERVAL_CLOSED_MS,
      isMarketOpen: isMarketOpen(),
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Fetch price for a single symbol and emit event.
   */
  async fetchAndEmit(symbol: string): Promise<void> {
    try {
      const quote = await getStockQuote(symbol);
      const event: LivePriceEvent = {
        symbol: quote.symbol,
        price: quote.lastPrice,
        change: quote.change,
        changePercent: quote.pChange,
        open: quote.open,
        dayHigh: quote.dayHigh,
        dayLow: quote.dayLow,
        previousClose: quote.previousClose,
        volume: quote.totalTradedVolume,
        timestamp: new Date().toISOString(),
      };

      // Update cache
      priceCache.notify(symbol, {
        price: event.price,
        change: event.change,
        changePercent: event.changePercent,
        timestamp: Date.now(),
      });

      // Emit to SSE clients
      this.emit("price", event);
    } catch (error) {
      logger.debug({ msg: "Price fetch failed for symbol", symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private startPolling(): void {
    const poll = async () => {
      const symbols = this.getTrackedSymbols();
      if (symbols.length === 0) return;

      // Fetch all tracked symbols in parallel (batch of 10)
      const batchSize = 10;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        await Promise.allSettled(batch.map((s) => this.fetchAndEmit(s)));
      }
    };

    // Immediate first poll
    poll().catch(() => {});

    // Then poll at interval
    this.pollTimer = setInterval(() => {
      const interval = isMarketOpen() ? POLL_INTERVAL_MS : POLL_INTERVAL_CLOSED_MS;
      // Re-create timer if interval changed
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
      this.pollTimer = setInterval(poll, interval);
      poll().catch(() => {});
    }, isMarketOpen() ? POLL_INTERVAL_MS : POLL_INTERVAL_CLOSED_MS);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.emit("heartbeat", { timestamp: new Date().toISOString() });
    }, HEARTBEAT_INTERVAL_MS);
  }
}

// Singleton
export const priceEventBus = new PriceEventBus();

/**
 * Helper to build SSE-formatted text for a price event.
 */
export function formatSSEMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
