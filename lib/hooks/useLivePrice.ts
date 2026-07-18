/**
 * useLivePrice — React hook for a single stock symbol's live price.
 *
 * Connects to the SSE endpoint for real-time price updates.
 * Falls back to polling (GET /api/nse/stock/{symbol}/quote) when SSE is
 * unavailable or on error.
 *
 * Usage:
 *   const { price, change, changePercent, isLoading, error, isLive } = useLivePrice("RELIANCE");
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface LivePriceState {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
  volume: number | null;
  isLoading: boolean;
  isLive: boolean; // true when SSE is connected
  error: string | null;
}

const POLL_INTERVAL = 30_000; // 30s polling fallback

export function useLivePrice(symbol: string): LivePriceState & { refetch: () => Promise<void> } {
  const [state, setState] = useState<LivePriceState>({
    price: null,
    change: null,
    changePercent: null,
    open: null,
    dayHigh: null,
    dayLow: null,
    previousClose: null,
    volume: null,
    isLoading: true,
    isLive: false,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const mountedRef = useRef(true);

  const updateState = useCallback((partial: Partial<LivePriceState>) => {
    if (mountedRef.current) {
      setState((prev) => ({ ...prev, ...partial }));
    }
  }, []);

  const fetchPrice = useCallback(async () => {
    try {
      const res = await fetch(`/api/nse/stock/${encodeURIComponent(symbol)}/quote`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      updateState({
        price: data.lastPrice,
        change: data.change,
        changePercent: data.pChange,
        open: data.open,
        dayHigh: data.dayHigh,
        dayLow: data.dayLow,
        previousClose: data.previousClose,
        volume: data.totalTradedVolume,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      updateState({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to fetch price",
      });
    }
  }, [symbol, updateState]);

  // SSE connection
  useEffect(() => {
    mountedRef.current = true;
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;

    // Initial fetch
    fetchPrice();

    // Try SSE
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    const connectSSE = () => {
      if (!mountedRef.current) return;

      // Cleanup previous
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      try {
        const es = new EventSource(`/api/prices/stream?symbols=${sym}`);
        eventSourceRef.current = es;

        es.addEventListener("connected", () => {
          reconnectAttempts.current = 0;
          updateState({ isLive: true, error: null });
          // Stop polling fallback
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        });

        es.addEventListener("price", (event) => {
          try {
            const data = JSON.parse(event.data);
            updateState({
              price: data.price,
              change: data.change,
              changePercent: data.changePercent,
              open: data.open,
              dayHigh: data.dayHigh,
              dayLow: data.dayLow,
              previousClose: data.previousClose,
              volume: data.volume,
              isLoading: false,
              isLive: true,
              error: null,
            });
          } catch { /* ignore parse errors */ }
        });

        es.addEventListener("initial", (event) => {
          try {
            const data = JSON.parse(event.data);
            const cached = data[sym];
            if (cached && state.price === null) {
              updateState({
                price: cached.price,
                change: cached.change,
                changePercent: cached.changePercent,
                isLoading: false,
              });
            }
          } catch { /* ignore */ }
        });

        es.onerror = () => {
          es.close();
          updateState({ isLive: false });

          // Exponential backoff reconnect
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30_000);
          reconnectAttempts.current++;
          reconnectTimeout = setTimeout(connectSSE, delay);

          // Start polling fallback
          if (!pollTimerRef.current) {
            pollTimerRef.current = setInterval(fetchPrice, POLL_INTERVAL);
          }
        };
      } catch {
        // SSE not supported — use polling
        updateState({ isLive: false });
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(fetchPrice, POLL_INTERVAL);
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
  }, [symbol, fetchPrice, updateState, state.price]);

  return {
    ...state,
    refetch: fetchPrice,
  };
}
