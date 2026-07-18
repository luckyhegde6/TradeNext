/**
 * useLivePrices — React hook for batch live prices from multiple symbols.
 *
 * Connects a single SSE connection for all symbols simultaneously.
 *
 * Usage:
 *   const { prices, isLoading, isLive } = useLivePrices(["RELIANCE", "TCS", "INFY"]);
 *   // prices.get("RELIANCE") → { price: 3256, change: 12.5, changePercent: 0.39, ... }
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface PricePoint {
  price: number;
  change: number;
  changePercent: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  volume: number;
}

export interface LivePricesState {
  prices: Map<string, PricePoint>;
  isLoading: boolean;
  isLive: boolean;
  error: string | null;
}

const POLL_INTERVAL = 30_000;

export function useLivePrices(symbols: string[]): LivePricesState {
  const [state, setState] = useState<LivePricesState>({
    prices: new Map(),
    isLoading: true,
    isLive: false,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempts = useRef(0);
  const mountedRef = useRef(true);

  const symbolsKey = symbols.sort().join(",");

  const updatePrices = useCallback((symbol: string, data: Partial<PricePoint>) => {
    if (!mountedRef.current) return;
    setState((prev) => {
      const next = new Map(prev.prices);
      const existing = next.get(symbol) || {} as PricePoint;
      next.set(symbol, { ...existing, ...data } as PricePoint);
      return { ...prev, prices: next, isLoading: false };
    });
  }, []);

  const fetchAllPrices = useCallback(async () => {
    for (const symbol of symbols) {
      try {
        const res = await fetch(`/api/nse/stock/${encodeURIComponent(symbol)}/quote`);
        if (res.ok) {
          const data = await res.json();
          updatePrices(symbol, {
            price: data.lastPrice,
            change: data.change,
            changePercent: data.pChange,
            open: data.open,
            dayHigh: data.dayHigh,
            dayLow: data.dayLow,
            previousClose: data.previousClose,
            volume: data.totalTradedVolume,
          });
        }
      } catch {
        // skip failed symbols
      }
    }
  }, [symbols, updatePrices]);

  useEffect(() => {
    mountedRef.current = true;
    if (symbols.length === 0) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    // Initial fetch
    fetchAllPrices();

    // Try SSE
    const symStr = symbols.map((s) => s.trim().toUpperCase()).join(",");
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connectSSE = () => {
      if (!mountedRef.current) return;
      if (eventSourceRef.current) eventSourceRef.current.close();

      try {
        const es = new EventSource(`/api/prices/stream?symbols=${symStr}`);
        eventSourceRef.current = es;

        es.addEventListener("connected", () => {
          reconnectAttempts.current = 0;
          setState((prev) => ({ ...prev, isLive: true, error: null }));
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        });

        es.addEventListener("price", (event) => {
          try {
            const data = JSON.parse(event.data);
            updatePrices(data.symbol, {
              price: data.price,
              change: data.change,
              changePercent: data.changePercent,
              open: data.open,
              dayHigh: data.dayHigh,
              dayLow: data.dayLow,
              previousClose: data.previousClose,
              volume: data.volume,
            });
          } catch { /* ignore */ }
        });

        es.addEventListener("initial", (event) => {
          try {
            const data = JSON.parse(event.data);
            for (const [sym, cached] of Object.entries(data)) {
              const c = cached as any;
              updatePrices(sym, {
                price: c.price,
                change: c.change,
                changePercent: c.changePercent,
              });
            }
          } catch { /* ignore */ }
        });

        es.onerror = () => {
          es.close();
          setState((prev) => ({ ...prev, isLive: false }));
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30_000);
          reconnectAttempts.current++;
          reconnectTimeout = setTimeout(connectSSE, delay);
          if (!pollTimerRef.current) {
            pollTimerRef.current = setInterval(fetchAllPrices, POLL_INTERVAL);
          }
        };
      } catch {
        setState((prev) => ({ ...prev, isLive: false }));
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(fetchAllPrices, POLL_INTERVAL);
        }
      }
    };

    connectSSE();

    return () => {
      mountedRef.current = false;
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [symbolsKey, fetchAllPrices, updatePrices]);

  return state;
}
