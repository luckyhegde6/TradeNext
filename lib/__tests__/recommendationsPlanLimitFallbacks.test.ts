/* @jest-environment node */

/**
 * Spec 01 — Recommendations plan-limit fallbacks (History / Performance / Ideas).
 *
 * Under the P6003 plan-limit hold the /recommendations History, Performance and
 * Ideas tabs used to bubble a 500 (and HistoryTab masked it as an empty state).
 * These tests prove the SQLite-mirror fallback ladder: Prisma happy path is
 * untouched, a hold error degrades to the mirror, and a mirror miss rethrows
 * the original failure (still a 500 — never silent masking).
 *
 * deps are mocked; route/service plumbing is real.
 */

import { GET as topStocksGET } from "@/app/api/recommendations/top-stocks/route";
import { getSqliteFallback } from "@/lib/sqlite";
import { recommendationsCache } from "@/lib/cache";
import { getPerformanceList, getPerformanceColumns } from "@/lib/services/recommendationPerformanceService";
import { getOrFetchSyncedData } from "@/lib/services/syncedDataService";
import { openPlanLimitBreaker, closePlanLimitBreaker } from "@/lib/db-utils";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}));
jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn(),
    recommendationTracker: { count: jest.fn(), findMany: jest.fn() },
    marketCache: { findUnique: jest.fn(), upsert: jest.fn() },
  },
  withAccelerateCache: jest.fn((_opts: unknown) => (args: unknown) => args),
}));
jest.mock("@/lib/sqlite", () => ({ __esModule: true, getSqliteFallback: jest.fn() }));
jest.mock("@/lib/cache", () => ({
  __esModule: true,
  default: { get: jest.fn(() => null), set: jest.fn(), del: jest.fn(), keys: jest.fn(() => []) },
  recommendationsCache: { get: jest.fn(() => undefined), set: jest.fn() },
}));
jest.mock("@/lib/audit", () => ({ __esModule: true, createAuditLog: jest.fn() }));

import prisma from "@/lib/prisma";

const mockQueryRaw = prisma.$queryRaw as jest.Mock;
const mockTrackerCount = prisma.recommendationTracker.count as jest.Mock;
const mockTrackerFindMany = prisma.recommendationTracker.findMany as jest.Mock;
const mockGetSqliteFallback = getSqliteFallback as jest.Mock;
const mockCacheSet = recommendationsCache.set as jest.Mock;
const mockMarketCacheFindUnique = prisma.marketCache.findUnique as jest.Mock;
const mockMarketCacheUpsert = prisma.marketCache.upsert as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const memCache = require("@/lib/cache").default as {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  keys: jest.Mock;
};

const holdError = Object.assign(
  new Error("There is a hold on your account. Reason: planLimitReached."),
  { code: "P6003" }
);

const req = (qs = "") => new Request(`http://localhost/api/recommendations/top-stocks${qs}`) as never;

// ---- Mirror fixtures: two runs (run-2 newer), RELIANCE in BOTH (dedupe case) ----

const runs = [
  // newest first (what getRecommendationRuns returns)
  {
    id: "run-2", runDate: "2026-09-22T04:30:00.000Z", status: "completed", uniqueStocks: 3,
  },
  {
    id: "run-1", runDate: "2026-09-20T04:30:00.000Z", status: "completed", uniqueStocks: 2,
  },
];

const stockMap: Record<string, Array<Record<string, unknown>>> = {
  "run-2": [
    { id: "s21", symbol: "RELIANCE", screenerCount: 5, screenerAttribution: ["s1"], price: 3030.5, change: 12.4, changePercent: 0.41, volume: 1200000, aiRecommendation: "BUY", confidence: 78, targetPrice: 3300, stopLoss: 2900, timeHorizon: "swing", reasoning: "up", riskFactors: null, aiSuccess: true },
    { id: "s22", symbol: "INFY", screenerCount: 3, screenerAttribution: ["s1", "s2"], price: 1502, change: -3, changePercent: -0.2, volume: 800000, aiRecommendation: "HOLD", confidence: 55, targetPrice: null, stopLoss: null, timeHorizon: "positional", reasoning: null, riskFactors: ["risk"], aiSuccess: false },
    { id: "s23", symbol: "TCS", screenerCount: 7, screenerAttribution: [], price: 4100, change: 20, changePercent: 0.49, volume: 500000, aiRecommendation: "BUY", confidence: 81, targetPrice: 4400, stopLoss: 3900, timeHorizon: "swing", reasoning: "breakout", riskFactors: null, aiSuccess: true },
  ],
  "run-1": [
    // RELIANCE older + SELL — must be DROPPED by dedupe (newest run wins, DISTINCT ON).
    { id: "s11", symbol: "RELIANCE", screenerCount: 2, screenerAttribution: [], price: 2500, change: 5, changePercent: 0.2, volume: 900000, aiRecommendation: "SELL", confidence: 40, targetPrice: null, stopLoss: null, timeHorizon: "swing", reasoning: null, riskFactors: null, aiSuccess: false },
    { id: "s12", symbol: "HDFC", screenerCount: 4, screenerAttribution: ["s3"], price: 1650, change: 8, changePercent: 0.49, volume: 600000, aiRecommendation: "BUY", confidence: 71, targetPrice: 1800, stopLoss: 1550, timeHorizon: "positional", reasoning: "fundamental", riskFactors: null, aiSuccess: true },
  ],
};

const trackers = [
  { symbol: "RELIANCE", entryPrice: 3000, currentPrice: 3100, status: "active" },
  { symbol: "INFY", entryPrice: null, currentPrice: null, status: "inactive" },
];

/** sqlite mock with route-read defaults; pass overrides to add/swap readers. */
function sqliteWith(overrides: Record<string, unknown> = {}) {
  mockGetSqliteFallback.mockReturnValue({
    isReady: () => true,
    getRecommendationRuns: jest.fn(() => runs),
    getRecommendationStocks: jest.fn((runId: string) => stockMap[runId] ?? []),
    getRecommendationTrackers: jest.fn(() => trackers),
    ...overrides,
  });
}

describe("Spec 01 — GET /api/recommendations/top-stocks (History fallback)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sqliteWith();
  });

  test("healthy Prisma path serves verbatim and never touches the mirror", async () => {
    const prismaRow = {
      id: "live-1", symbol: "AAPL", runid: "r9", screenercount: 9,
      screenerattribution: ["x"], price: 123, change: 1, changepercent: 0.8,
      volume: BigInt(10), airecommendation: "BUY", confidence: 90, targetprice: null,
      stoploss: null, timehorizon: "swing", reasoning: null, riskfactors: null,
      aisuccess: true, rundate: new Date("2026-09-23T04:30:00.000Z"),
      runstatus: "completed", currentprice: 130, entryprice: 120, trackerstatus: "active",
    };
    mockQueryRaw.mockResolvedValueOnce([prismaRow]).mockResolvedValueOnce([{ count: BigInt(1) }]);

    const res = await topStocksGET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.stocks).toEqual([
      {
        id: "live-1", symbol: "AAPL", runId: "r9", screenerCount: 9,
        screenerAttribution: ["x"], price: 123, change: 1, changePercent: 0.8,
        volume: 10, aiRecommendation: "BUY", confidence: 90, targetPrice: null,
        stopLoss: null, timeHorizon: "swing", reasoning: null, riskFactors: null,
        aiSuccess: true, runDate: "2026-09-23T04:30:00.000Z", runStatus: "completed",
        entryPrice: 120, currentPrice: 130, trackerStatus: "active",
      },
    ]);
    expect(body.total).toBe(1);
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });

  test("P6003 hold → 200 with mirror stocks: dedupe (newest wins), sort, total, tracker join", async () => {
    mockQueryRaw.mockRejectedValue(holdError);

    const res = await topStocksGET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.total).toBe(4);
    // screenerCount desc: TCS(7), RELIANCE(5), HDFC(4), INFY(3)
    expect(body.stocks.map((s: { symbol: string }) => s.symbol)).toEqual([
      "TCS", "RELIANCE", "HDFC", "INFY",
    ]);

    const reliance = body.stocks.find((s: { symbol: string }) => s.symbol === "RELIANCE");
    expect(reliance).toMatchObject({
      runId: "run-2", // newest run wins (older SELL row dropped)
      runDate: "2026-09-22T04:30:00.000Z",
      runStatus: "completed",
      screenerCount: 5,
      aiRecommendation: "BUY",
      entryPrice: 3000,
      currentPrice: 3100,
      trackerStatus: "active",
    });

    // LEFT JOIN semantics: INFY has a tracker row (null prices, inactive status),
    // TCS/HDFC have no tracker → nulls.
    const infy = body.stocks.find((s: { symbol: string }) => s.symbol === "INFY");
    expect(infy).toMatchObject({ entryPrice: null, currentPrice: null, trackerStatus: "inactive" });
    const tcs = body.stocks.find((s: { symbol: string }) => s.symbol === "TCS");
    expect(tcs).toMatchObject({ entryPrice: null, currentPrice: null, trackerStatus: null });
  });

  test("P6003 hold + filter=BUY → only BUY stocks, total counts filtered set", async () => {
    mockQueryRaw.mockRejectedValue(holdError);

    const res = await topStocksGET(req("?filter=BUY"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.total).toBe(3);
    expect(body.stocks.map((s: { symbol: string }) => s.symbol)).toEqual(["TCS", "RELIANCE", "HDFC"]);
  });

  test("P6003 hold + limit/offset pagination slices the deduped set", async () => {
    mockQueryRaw.mockRejectedValue(holdError);

    const res = await topStocksGET(req("?limit=2&offset=1"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.total).toBe(4); // full deduped count, not the slice
    expect(body.stocks.map((s: { symbol: string }) => s.symbol)).toEqual(["RELIANCE", "HDFC"]);
  });

  test("P6003 hold + mirror not ready → 500 (unchanged contract)", async () => {
    mockQueryRaw.mockRejectedValue(holdError);
    mockGetSqliteFallback.mockReturnValue(null);

    const res = await topStocksGET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to fetch top stocks" });
  });

  test("a non-hold DB error still surfaces as 500 without touching the mirror", async () => {
    mockQueryRaw.mockRejectedValue(new Error("syntax error near FROM"));

    const res = await topStocksGET(req());
    expect(res.status).toBe(500);
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });
});

// ---- Performance fallback fixtures: camelCase rehydrated mirror trackers ----

const perfTrackers: Array<Record<string, unknown>> = [
  {
    id: "tr-1", symbol: "RELIANCE", status: "active", timeHorizon: "swing",
    entryPrice: 3000, currentPrice: 3600, targetPrice: 3300, stopLoss: 2900,
    aiRecommendation: "BUY", confidence: 78, reasoning: "momentum",
    lastCheckedAt: new Date("2026-09-20T04:30:00.000Z"),
    createdAt: new Date("2026-09-01T04:30:00.000Z"),
  }, // returnPercent 20
  {
    id: "tr-2", symbol: "INFY", status: "target_achieved", timeHorizon: "medium",
    entryPrice: 1500, currentPrice: null, targetPrice: 1600, stopLoss: 1400,
    aiRecommendation: "BUY", confidence: 60, reasoning: null,
    lastCheckedAt: null, createdAt: new Date("2026-09-05T04:30:00.000Z"),
  }, // returnPercent null
  {
    id: "tr-3", symbol: "TCS", status: "stop_loss_hit", timeHorizon: "short",
    entryPrice: 4000, currentPrice: 3500, targetPrice: 4300, stopLoss: 3900,
    aiRecommendation: "SELL", confidence: 45, reasoning: null,
    lastCheckedAt: new Date("2026-09-21T04:30:00.000Z"),
    createdAt: new Date("2026-09-10T04:30:00.000Z"),
  }, // returnPercent -12.5
  {
    id: "tr-4", symbol: "TODAY_PICK", status: "active", timeHorizon: "btst",
    entryPrice: 100, currentPrice: 110, targetPrice: null, stopLoss: null,
    aiRecommendation: "BUY", confidence: 90, reasoning: null,
    lastCheckedAt: null, createdAt: new Date(), // created TODAY — excluded
  },
  {
    id: "tr-5", symbol: "NULLS", status: "active", timeHorizon: null,
    entryPrice: 500, currentPrice: null, targetPrice: null, stopLoss: null,
    aiRecommendation: null, confidence: null, reasoning: "edge",
    lastCheckedAt: null, createdAt: new Date("2026-09-08T04:30:00.000Z"),
  }, // category/aiRecommendation/returnPercent nulls survive
];

function trackerMirror(rows: Array<Record<string, unknown>>) {
  sqliteWith({ getRecommendationTrackers: jest.fn(() => rows) });
}

describe("Spec 01 — getPerformanceList (Performance fallback)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    trackerMirror(perfTrackers);
  });

  test("healthy Prisma path serves verbatim and never touches the mirror", async () => {
    const prismaRow = {
      id: "tr-live", symbol: "WIPRO", status: "active", timeHorizon: "short",
      entryPrice: 400, currentPrice: 440, targetPrice: 450, stopLoss: 380,
      aiRecommendation: "BUY", confidence: 88, reasoning: null,
      lastCheckedAt: new Date("2026-09-20T04:30:00.000Z"),
      createdAt: new Date("2026-08-20T04:30:00.000Z"),
    };
    mockTrackerCount.mockResolvedValue(1);
    mockTrackerFindMany.mockResolvedValue([prismaRow]);

    const out = await getPerformanceList({});

    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toEqual({
      id: "tr-live", symbol: "WIPRO", status: "active", category: "short",
      entryPrice: 400, currentPrice: 440, targetPrice: 450, stopLoss: 380,
      returnPercent: 10, daysTracked: expect.any(Number),
      aiRecommendation: "BUY", confidence: 88, reasoning: null,
      lastCheckedAt: "2026-09-20T04:30:00.000Z",
      createdAt: "2026-08-20T04:30:00.000Z",
    });
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });

  test("P6003 hold → mirror items: next-day promotion, nulls survive, total = filtered count", async () => {
    mockTrackerCount.mockRejectedValue(holdError);

    const out = await getPerformanceList({});

    // tr-4 (created today) excluded → 4 remaining (incl. tr-5 with null fields)
    expect(out.total).toBe(4);
    expect(out.items.map((i) => i.symbol).sort()).toEqual(["INFY", "NULLS", "RELIANCE", "TCS"]);
    expect(out.columns).toEqual(getPerformanceColumns());

    const reliance = out.items.find((i) => i.symbol === "RELIANCE");
    expect(reliance).toMatchObject({
      status: "active", category: "swing",
      entryPrice: 3000, currentPrice: 3600,
      returnPercent: 20, aiRecommendation: "BUY", confidence: 78,
      createdAt: "2026-09-01T04:30:00.000Z",
    });
    const infy = out.items.find((i) => i.symbol === "INFY");
    expect(infy).toMatchObject({ currentPrice: null, returnPercent: null, lastCheckedAt: null });
    const nulls = out.items.find((i) => i.symbol === "NULLS");
    expect(nulls).toMatchObject({ category: null, aiRecommendation: null, confidence: null });
  });

  test("status/category/recommendation filters apply in the fallback", async () => {
    mockTrackerCount.mockRejectedValue(holdError);

    const byStatus = await getPerformanceList({ status: "target_achieved" });
    expect(byStatus.items.map((i) => i.symbol)).toEqual(["INFY"]);

    const byCategory = await getPerformanceList({ category: "swing" });
    expect(byCategory.items.map((i) => i.symbol)).toEqual(["RELIANCE"]);

    const byRec = await getPerformanceList({ recommendation: "BUY" });
    // default sort createdAt desc → newer (INFY 09-05) first
    expect(byRec.items.map((i) => i.symbol)).toEqual(["INFY", "RELIANCE"]);
    expect(byRec.total).toBe(2);
  });

  test("sort=returnPercent desc puts top returners first, nulls last", async () => {
    mockTrackerCount.mockRejectedValue(holdError);

    const out = await getPerformanceList({ sort: "returnPercent", order: "desc" });

    expect(out.items[0].symbol).toBe("RELIANCE"); // 20
    expect(out.items[1].symbol).toBe("TCS"); // -12.5
    expect(out.items.slice(2).every((i) => i.returnPercent === null)).toBe(true); // INFY, NULLS
  });

  test("pagination slices the sorted set but total stays the full filtered count", async () => {
    mockTrackerCount.mockRejectedValue(holdError);

    const out = await getPerformanceList({ limit: 1, offset: 1 });

    expect(out.total).toBe(4);
    expect(out.items).toHaveLength(1);
  });

  test("P6003 hold + mirror not ready → rethrows (no silent masking)", async () => {
    mockTrackerCount.mockRejectedValue(holdError);
    mockGetSqliteFallback.mockReturnValue(null);

    await expect(getPerformanceList({})).rejects.toThrow(holdError.message);
  });

  test("a non-hold DB error rethrows without touching the mirror", async () => {
    mockTrackerCount.mockRejectedValue(new Error("connection lost"));

    await expect(getPerformanceList({})).rejects.toThrow("connection lost");
    expect(mockGetSqliteFallback).not.toHaveBeenCalled();
  });
});

// ---- Ideas fallback fixtures (syncedDataService mirror row) ----

const ideasData = [
  { symbol: "RELIANCE", strategy: "breakout" },
  { symbol: "TCS", strategy: "pullback" },
];

const ideasMirrorRow = {
  data: ideasData,
  last_synced_at: "2026-08-11T10:00:00.000Z",
};

/** sqlite mock exposing just the market_cache readers/writers. */
function ideasSqlite(row: Record<string, unknown> | null) {
  sqliteWith({
    getMarketCache: jest.fn(() => row),
    upsertMarketCache: jest.fn(),
  });
}

interface Idea {
  symbol: string;
  strategy: string;
}

const ideasFetch = async () => ideasData;

describe("Spec 01 — getOrFetchSyncedData (Ideas fallback)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closePlanLimitBreaker();
    memCache.get.mockReturnValue(null);
    mockMarketCacheFindUnique.mockResolvedValue(null);
    ideasSqlite(null);
  });

  afterEach(() => {
    closePlanLimitBreaker();
  });

  test("healthy API + DB persist path is unchanged and never touches the mirror", async () => {
    const res = await getOrFetchSyncedData<Idea[]>({
      cacheKey: "test_key",
      dataType: "test_type",
      fetchFromApi: ideasFetch,
    });

    expect(res).toMatchObject({ data: ideasData, source: "api", changed: true });
    expect(mockMarketCacheFindUnique).toHaveBeenCalledWith({ where: { cacheKey: "test_key" } });
    expect(mockMarketCacheUpsert).toHaveBeenCalledTimes(1);
    const sqlite = mockGetSqliteFallback();
    expect(sqlite.getMarketCache).not.toHaveBeenCalled();
    expect(sqlite.upsertMarketCache).not.toHaveBeenCalled();
  });

  test("P6003 on the change-check (breaker closed race) → serve API payload, mirror write-through", async () => {
    mockMarketCacheFindUnique.mockRejectedValue(holdError);

    const res = await getOrFetchSyncedData<Idea[]>({
      cacheKey: "test_key",
      dataType: "test_type",
      fetchFromApi: ideasFetch,
    });

    expect(res).toMatchObject({ data: ideasData, source: "api", changed: false });
    expect(mockMarketCacheUpsert).not.toHaveBeenCalled(); // DB untouched
    const sqlite = mockGetSqliteFallback();
    expect(sqlite.upsertMarketCache).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: "test_key",
        dataType: "test_type",
        data: ideasData,
        recordCount: 2,
      })
    );
    expect(memCache.set).toHaveBeenCalledWith(
      "sync:test_key",
      expect.objectContaining({ data: ideasData }),
      expect.any(Number)
    );
  });

  test("breaker open + API success → ZERO Prisma ops, mirror write-through, source=api", async () => {
    openPlanLimitBreaker();

    const res = await getOrFetchSyncedData<Idea[]>({
      cacheKey: "test_key",
      dataType: "test_type",
      fetchFromApi: ideasFetch,
    });

    expect(res).toMatchObject({ data: ideasData, source: "api", changed: false });
    expect(mockMarketCacheFindUnique).not.toHaveBeenCalled();
    expect(mockMarketCacheUpsert).not.toHaveBeenCalled();
    const sqlite = mockGetSqliteFallback();
    expect(sqlite.upsertMarketCache).toHaveBeenCalledTimes(1);
  });

  test("API failure + breaker open + mirror row → serves mirror (source=db, zero Prisma)", async () => {
    openPlanLimitBreaker();
    ideasSqlite(ideasMirrorRow);

    const res = await getOrFetchSyncedData<Idea[]>({
      cacheKey: "test_key",
      dataType: "test_type",
      fetchFromApi: async () => {
        throw new Error("NSE down");
      },
    });

    expect(res).toMatchObject({ data: ideasData, source: "db", changed: false });
    expect(res.syncedAt).toEqual(new Date("2026-08-11T10:00:00.000Z"));
    expect(mockMarketCacheFindUnique).not.toHaveBeenCalled();
    // short TTL so the next read retries the upstream API
    expect(memCache.set).toHaveBeenCalledWith(
      "sync:test_key",
      expect.objectContaining({ data: ideasData }),
      300
    );
  });

  test("API failure + breaker open + mirror miss → rethrows the original failure", async () => {
    openPlanLimitBreaker();
    ideasSqlite(null);

    await expect(
      getOrFetchSyncedData<Idea[]>({
        cacheKey: "test_key",
        dataType: "test_type",
        fetchFromApi: async () => {
          throw new Error("NSE down");
        },
      })
    ).rejects.toThrow("NSE down");
    expect(mockMarketCacheFindUnique).not.toHaveBeenCalled();
  });

  test("API failure + P6003 on DB fallback read + mirror row → serves mirror (source=db)", async () => {
    ideasSqlite(ideasMirrorRow);
    mockMarketCacheFindUnique.mockRejectedValue(holdError);

    const res = await getOrFetchSyncedData<Idea[]>({
      cacheKey: "test_key",
      dataType: "test_type",
      fetchFromApi: async () => {
        throw new Error("NSE down");
      },
    });

    expect(res).toMatchObject({ data: ideasData, source: "db", changed: false });
    expect(res.syncedAt).toEqual(new Date("2026-08-11T10:00:00.000Z"));
  });

  test("API failure + non-hold DB read error → rethrows without touching the mirror", async () => {
    // Pre-existing contract: the step-3 DB read throw escapes directly (never
    // masked); the mirror is only probed for HOLD errors.
    mockMarketCacheFindUnique.mockRejectedValue(new Error("syntax error near FROM"));

    await expect(
      getOrFetchSyncedData<Idea[]>({
        cacheKey: "test_key",
        dataType: "test_type",
        fetchFromApi: async () => {
          throw new Error("NSE down");
        },
      })
    ).rejects.toThrow("syntax error near FROM");
    const sqlite = mockGetSqliteFallback();
    expect(sqlite.getMarketCache).not.toHaveBeenCalled();
  });

  test("API failure + breaker closed + DB row exists → serves DB (regression guard)", async () => {
    mockMarketCacheFindUnique.mockResolvedValue({
      cacheKey: "test_key",
      data: ideasData,
      lastSyncedAt: new Date("2026-08-11T10:00:00.000Z"),
    });

    const res = await getOrFetchSyncedData<Idea[]>({
      cacheKey: "test_key",
      dataType: "test_type",
      fetchFromApi: async () => {
        throw new Error("NSE down");
      },
    });

    expect(res).toMatchObject({ data: ideasData, source: "db", changed: false });
    expect(res.syncedAt).toEqual(new Date("2026-08-11T10:00:00.000Z"));
    const sqlite = mockGetSqliteFallback();
    expect(sqlite.getMarketCache).not.toHaveBeenCalled(); // DB served → mirror untouched
  });
});