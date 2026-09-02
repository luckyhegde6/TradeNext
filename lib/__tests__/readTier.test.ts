// lib/__tests__/readTier.test.ts
//
// v3.23.x — read-tier / cache / SQLite latency telemetry registry.
// Pure module (imports nothing), counters live on globalThis `__readTier`.

import {
  recordRead,
  getReadMetrics,
  resetReadMetrics,
  LONG_QUERY_MS,
  type ReadSource,
} from "@/lib/services/readTier";

describe("readTier telemetry registry", () => {
  beforeEach(() => {
    resetReadMetrics();
  });

  it("records a read and aggregates it into byReader + bySource", () => {
    recordRead("recs.sqlite", { source: "sqlite", latencyMs: 5, rows: 20, hit: true });

    const m = getReadMetrics();
    expect(m.totalCalls).toBe(1);

    const reader = m.byReader.find((r) => r.name === "recs.sqlite");
    expect(reader).toBeDefined();
    expect(reader?.source).toBe("sqlite");
    expect(reader?.calls).toBe(1);
    expect(reader?.hits).toBe(1);
    expect(reader?.misses).toBe(0);
    expect(reader?.latency.last).toBe(5);
    expect(reader?.rows).toBe(20);

    const src = m.bySource.sqlite;
    expect(src.calls).toBe(1);
    expect(src.hits).toBe(1);
    expect(src.misses).toBe(0);
    expect(src.rows).toBe(20);
    expect(src.totalMs).toBe(5);
  });

  it("computes min/max/avg latency across repeated reads", () => {
    recordRead("x", { source: "sqlite", latencyMs: 10, rows: 1, hit: true });
    recordRead("x", { source: "sqlite", latencyMs: 30, rows: 1, hit: false });
    recordRead("x", { source: "sqlite", latencyMs: 20, rows: 1, hit: true });

    const reader = getReadMetrics().byReader.find((r) => r.name === "x");
    expect(reader?.latency.min).toBe(10);
    expect(reader?.latency.max).toBe(30);
    expect(reader?.latency.avg).toBe(20);
    expect(reader?.latency.last).toBe(20);
  });

  it("counts misses when hit=false", () => {
    recordRead("swing.prisma", { source: "prisma", latencyMs: 15, rows: 8, hit: false });

    const m = getReadMetrics();
    const reader = m.byReader.find((r) => r.name === "swing.prisma");
    expect(reader?.hits).toBe(0);
    expect(reader?.misses).toBe(1);
    expect(m.bySource.prisma.misses).toBe(1);
    expect(m.bySource.prisma.hits).toBe(0);
  });

  it("defaults source to other and hit/miss to miss when omitted", () => {
    (["other"] as const).forEach(() => {
      recordRead("bare.read", {});
    });

    const reader = getReadMetrics().byReader.find((r) => r.name === "bare.read");
    expect(reader?.source).toBe("other");
    expect(reader?.misses).toBe(1);
    expect(reader?.hits).toBe(0);
  });

  it("separates readers by name even with the same source", () => {
    recordRead("a", { source: "sqlite", hit: true });
    recordRead("b", { source: "sqlite", hit: true });

    const m = getReadMetrics();
    expect(m.byReader).toHaveLength(2);
    expect(m.bySource.sqlite.calls).toBe(2);
  });

  it("captures reads over LONG_QUERY_MS as long queries, sorted desc", () => {
    recordRead("slow1", { source: "sqlite", latencyMs: LONG_QUERY_MS + 50, rows: 5 });
    recordRead("fast", { source: "sqlite", latencyMs: 10 });
    recordRead("slow2", { source: "prisma", latencyMs: LONG_QUERY_MS + 200, rows: 100 });

    const m = getReadMetrics();
    expect(m.longQueries).toHaveLength(2);
    expect(m.longQueries[0].name).toBe("slow2");
    expect(m.longQueries[1].name).toBe("slow1");
    expect(m.longQueries.every((q) => q.latencyMs > LONG_QUERY_MS)).toBe(true);
  });

  it("does NOT record sub-threshold reads as long queries", () => {
    recordRead("ok", { source: "sqlite", latencyMs: 50, rows: 1 });
    expect(getReadMetrics().longQueries).toHaveLength(0);
  });

  it("caps the long-query ring at MAX_LONG entries", () => {
    const many = 25;
    for (let i = 0; i < many; i++) {
      recordRead(`slow-${i}`, { source: "sqlite", latencyMs: LONG_QUERY_MS + 500, rows: 1 });
    }
    expect(getReadMetrics().longQueries.length).toBeLessThanOrEqual(15);
  });

  it("surfaces SQLite performance aggregation (calls / avg / min / max)", () => {
    recordRead("a", { source: "sqlite", latencyMs: 10, hit: true });
    recordRead("b", { source: "sqlite", latencyMs: 30, hit: true });

    const s = getReadMetrics().sqlite;
    expect(s.calls).toBe(2);
    expect(s.totalMs).toBe(40);
    expect(s.avgMs).toBe(20);
    expect(s.minMs).toBe(10);
    expect(s.maxMs).toBe(30);
  });

  it("returns a clean snapshot after reset", () => {
    recordRead("x", { source: "sqlite", hit: true });
    resetReadMetrics();
    const m = getReadMetrics();
    expect(m.totalCalls).toBe(0);
    expect(m.byReader).toHaveLength(0);
    expect(m.longQueries).toHaveLength(0);
    expect(m.bySource.sqlite.calls).toBe(0);
  });

  it("handles all supported source keys without throwing", () => {
    const sources: ReadSource[] = ["sqlite", "memory", "prisma", "nse", "filesystem", "other"];
    sources.forEach((s) => recordRead(s, { source: s, latencyMs: 1, hit: true }));
    const m = getReadMetrics();
    expect(Object.keys(m.bySource).sort()).toEqual([...sources].sort());
    expect(m.totalCalls).toBe(sources.length);
  });
});