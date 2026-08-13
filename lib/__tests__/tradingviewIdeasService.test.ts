/**
 * Tests for lib/services/tradingviewIdeasService.ts (v3.6.3).
 *
 * Covers parsing of the TradingView India ideas payload and the NSE filter:
 *   - items are parsed and NSE-only items are kept
 *   - BSE / non-NSE items are dropped
 *   - malformed payloads degrade gracefully (no items, no crash)
 *   - API failure with a persisted DB row falls back to the DB
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

import { getNseTradingIdeas } from "@/lib/services/tradingviewIdeasService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  marketCache: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

const nseIdea = {
  id: 101,
  name: "NIFTY looks strong above 49000",
  description: "Bullish structure with higher lows.",
  created_at: "2026-08-12T08:00:00Z",
  date_timestamp: 1785384000,
  chart_url: "https://in.tradingview.com/chart/abc123/",
  symbol: { name: "NSE:NIFTY", full_name: "NSE:NIFTY", short_name: "NIFTY", exchange: "NSE" },
  user: { username: "chartist" },
  likes_count: 12,
  comments_count: 3,
  views_count: 450,
  image: { big: "https://img.example/big.jpg" },
  is_hot: true,
  is_picked: false,
};

const bseIdea = {
  id: 202,
  name: "SENSEX breakout",
  description: "Momentum on the index.",
  created_at: "2026-08-12T07:00:00Z",
  date_timestamp: 1785380400,
  chart_url: "https://in.tradingview.com/chart/xyz/",
  symbol: { name: "BSE:SENSEX", full_name: "BSE:SENSEX", short_name: "SENSEX", exchange: "BSE" },
  user: { username: "mumbaibull" },
  likes_count: 5,
  comments_count: 1,
  views_count: 200,
};

const cryptoIdea = {
    id: 303,
    name: "BTC range",
    description: "",
    created_at: "2026-08-12T06:00:00Z",
    date_timestamp: 1785376800,
    chart_url: "https://in.tradingview.com/chart/btc/",
    symbol: { name: "BITSTAMP:BTCUSD", full_name: "BITSTAMP:BTCUSD", short_name: "BTCUSD", exchange: "BITSTAMP" },
    user: { username: "cryptoking" },
    likes_count: 99,
    comments_count: 10,
    views_count: 5000,
  };

function tvPayload(items: unknown[]) {
  return { data: { ideas: { data: { items } } } };
}

describe("getNseTradingIdeas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.marketCache.findUnique.mockResolvedValue(null);
    prisma.marketCache.upsert.mockResolvedValue({});
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => tvPayload([nseIdea, bseIdea, cryptoIdea]),
    })) as unknown;
  });

  afterEach(() => {
    delete (global as { fetch?: unknown }).fetch;
  });

  it("parses items and keeps only NSE-listed ideas", async () => {
    const res = await getNseTradingIdeas();

    expect(res.source).toBe("api");
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      id: 101,
      symbolFullName: "NSE:NIFTY",
      symbolShortName: "NIFTY",
      exchange: "NSE",
      username: "chartist",
      likesCount: 12,
      isHot: true,
    });
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
    const { create } = prisma.marketCache.upsert.mock.calls[0][0];
    expect(create.cacheKey).toBe("tradingview_nse_ideas");
    expect(create.dataType).toBe("tv_ideas_nse");
    expect(create.recordCount).toBe(1);
  });

  it("keeps an idea whose symbol exchange is missing but name starts with NSE:", async () => {
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () =>
        tvPayload([
          {
            id: 404,
            name: "RELIANCE momentum",
            description: "",
            created_at: "",
            date_timestamp: 0,
            chart_url: "",
            symbol: { name: "NSE:RELIANCE", full_name: "NSE:RELIANCE", short_name: "RELIANCE" },
            user: {},
            likes_count: 1,
            comments_count: 0,
            views_count: 10,
          },
          bseIdea,
        ]),
    })) as unknown;

    const res = await getNseTradingIdeas();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].symbolFullName).toBe("NSE:RELIANCE");
  });

  it("degrades gracefully on a malformed payload", async () => {
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: { ideas: { data: { items: "not-an-array" } } } }),
    })) as unknown;

    const res = await getNseTradingIdeas();
    expect(res.data).toEqual([]);
    expect(res.source).toBe("api");
  });

  it("throws on non-OK API response → falls back to DB if persisted", async () => {
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
    })) as unknown;
    const persisted = [
      { ...nseIdea, name: "cached idea" },
    ];
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "tradingview_nse_ideas",
      data: persisted,
      lastSyncedAt: new Date("2026-08-11T10:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T08:00:00.000Z"),
    });

    const res = await getNseTradingIdeas();
    expect(res).toMatchObject({ data: persisted, source: "db", changed: false });
  });
});