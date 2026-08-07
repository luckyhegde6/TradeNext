import { renderHook, act, waitFor } from "@testing-library/react";
import { useLivePrices } from "@/lib/hooks/useLivePrices";

// Mock global fetch (used by the polling fallback path)
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock EventSource (SSE)
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  onerror: (() => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  close() {
    /* no-op */
  }
}
(global as any).EventSource = MockEventSource;

describe("useLivePrices", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    MockEventSource.instances = [];
  });

  it("returns loading=false with empty prices for an empty symbol list", () => {
    const { result } = renderHook(() => useLivePrices([]));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.prices.size).toBe(0);
    expect(result.current.isLive).toBe(false);
  });

  it("does not loop when the caller passes a fresh array reference each render (symbols unchanged)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        lastPrice: 1327.6,
        change: 23,
        pChange: 1.76,
        open: 1305,
        dayHigh: 1330,
        dayLow: 1300,
        previousClose: 1304.6,
        totalTradedVolume: 100000,
      }),
    });

    const { result, rerender } = renderHook(({ symbols }) => useLivePrices(symbols), {
      initialProps: { symbols: ["RELIANCE", "TCS"] },
    });

    // Simulate the caller re-creating the symbols array on every render
    rerender({ symbols: ["RELIANCE", "TCS"] });
    rerender({ symbols: ["RELIANCE", "TCS"] });
    rerender({ symbols: ["RELIANCE", "TCS"] });

    await waitFor(() => {
      expect(result.current.prices.get("RELIANCE")?.price).toBe(1327.6);
    });

    // Only one EventSource connection should have been created (no re-run loops)
    expect(MockEventSource.instances.length).toBe(1);
  });

  it("updates prices when SSE emits a price event", async () => {
    const { result } = renderHook(() => useLivePrices(["INFY"]));

    const es = MockEventSource.instances[0];
    expect(es).toBeDefined();

    act(() => {
      es.listeners["price"]?.forEach((cb) =>
        cb({ data: JSON.stringify({ symbol: "INFY", price: 1450.5, change: 10, changePercent: 0.69 }) })
      );
    });

    await waitFor(() => {
      expect(result.current.prices.get("INFY")?.price).toBe(1450.5);
    });
    expect(result.current.prices.get("INFY")?.changePercent).toBe(0.69);
  });

  it("marks isLive true when SSE connected event fires", async () => {
    const { result } = renderHook(() => useLivePrices(["TCS"]));

    const es = MockEventSource.instances[0];
    act(() => {
      es.listeners["connected"]?.forEach((cb) => cb({ data: JSON.stringify({}) }));
    });

    await waitFor(() => {
      expect(result.current.isLive).toBe(true);
    });
  });
});
