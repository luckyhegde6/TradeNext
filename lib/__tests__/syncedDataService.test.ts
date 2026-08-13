/**
 * Tests for lib/services/syncedDataService.ts (v3.6.3).
 *
 * Covers the shared memory → API → DB chain:
 *   - memory cache hit returns "cache" with 0 DB/API ops
 *   - API success with no DB row → DB upsert (create), changed=true
 *   - API success + payload unchanged vs DB → DB write SKIPPED, changed=false
 *   - API success + payload changed vs DB → DB upsert (update), changed=true
 *   - API failure + memory empty + DB row → DB fallback serve ("db")
 *   - API failure + no DB row → throws
 *   - forceRefresh bypasses memory but still change-detects the DB write
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/cache", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => null),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(() => []),
  },
}));

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    marketCache: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  getOrFetchSyncedData,
  DEFAULT_SYNC_TTL_SECONDS,
  type SyncedFetchOptions,
} from "@/lib/services/syncedDataService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cache = require("@/lib/cache").default as {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  keys: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  marketCache: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

interface Item {
  name: string;
  value: number;
}

const sampleData: Item[] = [
  { name: "a", value: 1 },
  { name: "b", value: 2 },
];

const sampleData2: Item[] = [
  { name: "a", value: 1 },
  { name: "b", value: 99 },
];

function makeOptions(
  overrides: Partial<SyncedFetchOptions<Item[]>> & { fetchFromApi: () => Promise<Item[]> }
): SyncedFetchOptions<Item[]> {
  return {
    cacheKey: "test_key",
    dataType: "test_type",
    ...overrides,
  };
}

describe("getOrFetchSyncedData — memory-first chain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockReturnValue(null);
    prisma.marketCache.findUnique.mockResolvedValue(null);
    prisma.marketCache.upsert.mockResolvedValue({
      cacheKey: "test_key",
      lastSyncedAt: new Date("2026-08-12T10:00:00.000Z"),
    });
  });

  it("serves from memory cache without touching DB or API", async () => {
    cache.get.mockReturnValue({ data: sampleData, syncedAt: new Date() });

    const fetchApi = jest.fn(async () => sampleData2); // would be a changed payload
    const res = await getOrFetchSyncedData<Item[]>(makeOptions({ fetchFromApi: fetchApi }));

    expect(res).toMatchObject({ data: sampleData, source: "cache", changed: false });
    expect(fetchApi).not.toHaveBeenCalled();
    expect(prisma.marketCache.findUnique).not.toHaveBeenCalled();
    expect(prisma.marketCache.upsert).not.toHaveBeenCalled();
  });

  it("API success + no DB row → creates DB row (changed=true, source=api)", async () => {
    const fetchApi = jest.fn(async () => sampleData);
    const res = await getOrFetchSyncedData<Item[]>(makeOptions({ fetchFromApi: fetchApi }));

    expect(res).toMatchObject({ data: sampleData, source: "api", changed: true });
    expect(fetchApi).toHaveBeenCalledTimes(1);
    expect(prisma.marketCache.findUnique).toHaveBeenCalledWith({ where: { cacheKey: "test_key" } });
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);

    const { create, update } = prisma.marketCache.upsert.mock.calls[0][0];
    expect(create.cacheKey).toBe("test_key");
    expect(create.dataType).toBe("test_type");
    expect(create.data).toEqual(sampleData);
    expect(create.recordCount).toBe(2);
    expect(update.data).toEqual(sampleData);
    expect(cache.set).toHaveBeenCalledWith(
      "sync:test_key",
      expect.objectContaining({ data: sampleData }),
      DEFAULT_SYNC_TTL_SECONDS
    );
  });

  it("API success + identical payload → DB write SKIPPED (changed=false)", async () => {
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "test_key",
      data: sampleData,
      lastSyncedAt: new Date("2026-08-12T01:00:00.000Z"), // old — past the 24h TTL
      nextSyncAt: new Date("2026-08-11T01:00:00.000Z"),
    });

    const fetchApi = jest.fn(async () => sampleData);
    const res = await getOrFetchSyncedData<Item[]>(makeOptions({ fetchFromApi: fetchApi }));

    expect(res).toMatchObject({ data: sampleData, source: "api", changed: false });
    expect(prisma.marketCache.upsert).not.toHaveBeenCalled(); // unchanged → ignore DB sync
    expect(cache.set).toHaveBeenCalledTimes(1); // memory still refreshed
  });

  it("identical payload with jsonb-reordered keys → DB write STILL skipped", async () => {
    // Postgres jsonb sorts object keys alphabetically on read — the persisted
    // row therefore has different key order than the live payload. Semantic
    // equality must still be detected (stable stringify), else every refresh
    // rewrites the DB forever.
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "test_key",
      data: [
        { b: 2, a: 1 },
        { name: "z" },
      ],
      lastSyncedAt: new Date("2026-08-12T01:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T02:00:00.000Z"),
    });

    type LooseRecord = Record<string, string | number>;
    const fetchApi: () => Promise<LooseRecord[]> = jest.fn(async () => [
      { a: 1, b: 2 },
      { name: "z" },
    ] as LooseRecord[]);
    const res = await getOrFetchSyncedData<LooseRecord[]>({
      cacheKey: "test_key",
      dataType: "test_type",
      fetchFromApi: fetchApi,
    });

    expect(res).toMatchObject({ source: "api", changed: false });
    expect(prisma.marketCache.upsert).not.toHaveBeenCalled();
  });

  it("API success + changed payload → DB row updated (changed=true)", async () => {
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "test_key",
      data: sampleData,
      lastSyncedAt: new Date("2026-08-12T01:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T02:00:00.000Z"),
    });

    const fetchApi = jest.fn(async () => sampleData2);
    const res = await getOrFetchSyncedData<Item[]>(makeOptions({ fetchFromApi: fetchApi }));

    expect(res).toMatchObject({ data: sampleData2, source: "api", changed: true });
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
    const { update } = prisma.marketCache.upsert.mock.calls[0][0];
    expect(update.data).toEqual(sampleData2);
    expect(update.recordCount).toBe(2);
  });

  it("API failure + memory empty + DB row exists → serves DB fallback (source=db)", async () => {
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "test_key",
      data: sampleData,
      lastSyncedAt: new Date("2026-08-11T10:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T08:00:00.000Z"),
    });

    const fetchApi = jest.fn(async () => {
      throw new Error("NSE down");
    });

    const res = await getOrFetchSyncedData<Item[]>(makeOptions({ fetchFromApi: fetchApi }));

    expect(res).toMatchObject({ data: sampleData, source: "db", changed: false });
    expect(res.syncedAt).toEqual(new Date("2026-08-11T10:00:00.000Z"));
    expect(prisma.marketCache.upsert).not.toHaveBeenCalled();
    // Fallback memory entry gets the SHORT TTL (5min) so we retry the API soon
    expect(cache.set).toHaveBeenCalledWith(
      "sync:test_key",
      expect.objectContaining({ data: sampleData }),
      300
    );
  });

  it("API failure + no DB row → rethrows original error", async () => {
    prisma.marketCache.findUnique.mockResolvedValue(null);
    const fetchApi = jest.fn(async () => {
      throw new Error("NSE down");
    });

    await expect(
      getOrFetchSyncedData<Item[]>(makeOptions({ fetchFromApi: fetchApi }))
    ).rejects.toThrow("NSE down");
    expect(prisma.marketCache.upsert).not.toHaveBeenCalled();
  });

  it("forceRefresh bypasses memory but still change-detects the DB write", async () => {
    cache.get.mockReturnValue({ data: sampleData, syncedAt: new Date() });
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "test_key",
      data: sampleData2, // differs from the payload the API will return
      lastSyncedAt: new Date("2026-08-12T01:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T02:00:00.000Z"),
    });

    const fetchApi = jest.fn(async () => sampleData);
    const res = await getOrFetchSyncedData<Item[]>(makeOptions({ fetchFromApi: fetchApi }), true);

    expect(res).toMatchObject({ data: sampleData, source: "api", changed: true });
    expect(fetchApi).toHaveBeenCalledTimes(1);
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
  });
});