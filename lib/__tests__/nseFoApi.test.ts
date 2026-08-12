// lib/__tests__/nseFoApi.test.ts
// Tests for the F&O option-chain-v3 service:
//   - pure date helpers (parseNseExpiryDate / parseNseTimestamp / toNseExpiryParam)
//   - v3 response parser (renamed bid/ask fields, pchangeinOpenInterest,
//     empty {} contracts, filtered per-side totals, NSE date formats)
//   - fetchOptionChain URL building (type=Indices|Stocks, expiry param)
// Pure logic — nseFetch is mocked, so no network calls in tests.

import {
  parseNseExpiryDate,
  parseNseTimestamp,
  toNseExpiryParam,
  isIndexSymbol,
  parseOptionChainV3,
  fetchOptionChain,
  fetchExpiries,
  type FOChainData,
} from "@/lib/services/nse-fo-api";
import { nseFetch } from "@/lib/nse-client";

jest.mock("@/lib/nse-client", () => ({
  nseFetch: jest.fn(),
}));

const mockedNseFetch = nseFetch as jest.MockedFunction<typeof nseFetch>;

// ─── v3 sample fixture (mirrors the real NSE /api/option-chain-v3 payload) ──

const v3Sample = {
  records: {
    expiryDates: ["18-Aug-2026", "25-Aug-2026", "01-Sep-2026", "29-Sep-2026"],
    strikePrices: [24200, 24300, 24400, 24500, 24600, 24700, 24800],
    timestamp: "12-Aug-2026 15:40:00",
    underlyingValue: 24435.95,
    data: [
      {
        expiryDates: "18-Aug-2026",
        strikePrice: 24500,
        CE: {
          buyPrice1: 117.75,
          buyQuantity1: 900,
          sellPrice1: 118.85,
          sellQuantity1: 600,
          change: 0.6,
          changeinOpenInterest: 163275,
          pchangeinOpenInterest: 9.3,
          expiryDate: "18-08-2026",
          identifier: "NIFTY18AUG2026CE24500",
          impliedVolatility: 10.26,
          lastPrice: 117.75,
          openInterest: 1918926,
          pChange: 0.51,
          strikePrice: 24500,
          totalBuyQuantity: 900,
          totalSellQuantity: 600,
          totalTradedVolume: 21566918,
          underlying: "NIFTY",
          underlyingValue: 24435.95,
        },
        PE: {
          buyPrice1: 88.35,
          buyQuantity1: 450,
          sellPrice1: 89.45,
          sellQuantity1: 300,
          change: -1.2,
          changeinOpenInterest: 41250,
          pchangeinOpenInterest: 4.1,
          expiryDate: "18-08-2026",
          identifier: "NIFTY18AUG2026PE24500",
          impliedVolatility: 11.02,
          lastPrice: 88.35,
          openInterest: 1046000,
          pChange: -1.34,
          strikePrice: 24500,
          totalBuyQuantity: 450,
          totalSellQuantity: 300,
          totalTradedVolume: 8923411,
          underlying: "NIFTY",
          underlyingValue: 24435.95,
        },
      },
      {
        expiryDates: "18-Aug-2026",
        strikePrice: 24600,
        // Unquoted strike — empty {} CE/PE objects must be skipped, not crash.
        CE: {},
        PE: {},
      },
    ],
  },
  filtered: {
    data: [],
    CE: { totOI: 1918926, totVol: 21566918 },
    PE: { totOI: 1046000, totVol: 8923411 },
  },
};

// ─── Date helpers ──────────────────────────────────────────────────────────

describe("parseNseExpiryDate", () => {
  it("parses DD-MMM-YYYY (records.expiryDates)", () => {
    expect(parseNseExpiryDate("18-Aug-2026")).toBe("2026-08-18");
  });

  it("parses DD-MM-YYYY (per-side expiryDate)", () => {
    expect(parseNseExpiryDate("18-08-2026")).toBe("2026-08-18");
  });

  it("passes through ISO dates unchanged", () => {
    expect(parseNseExpiryDate("2026-08-18")).toBe("2026-08-18");
    expect(parseNseExpiryDate("2026-08-18T00:00:00.000Z")).toBe("2026-08-18");
  });

  it("returns empty/unknown input unchanged", () => {
    expect(parseNseExpiryDate("")).toBe("");
    expect(parseNseExpiryDate("nonsense")).toBe("nonsense");
  });
});

describe("parseNseTimestamp", () => {
  it("parses DD-MMM-YYYY HH:mm:ss into an ISO string", () => {
    const iso = parseNseTimestamp("12-Aug-2026 15:40:00");
    expect(iso).toMatch(/^2026-08-12T15:40:00/);
  });

  it("passes through already-ISO input", () => {
    const iso = "2026-08-12T15:40:00.000Z";
    expect(parseNseTimestamp(iso)).toBe(iso);
  });

  it("returns empty input unchanged", () => {
    expect(parseNseTimestamp("")).toBe("");
  });
});

describe("toNseExpiryParam", () => {
  it("converts ISO date to DD-MMM-YYYY", () => {
    expect(toNseExpiryParam("2026-08-18")).toBe("18-Aug-2026");
  });

  it("passes through already-formatted DD-MMM-YYYY", () => {
    expect(toNseExpiryParam("18-Aug-2026")).toBe("18-Aug-2026");
  });
});

describe("isIndexSymbol", () => {
  it("flags index derivatives", () => {
    expect(isIndexSymbol("NIFTY")).toBe(true);
    expect(isIndexSymbol("BANKNIFTY")).toBe(true);
    expect(isIndexSymbol("FINNIFTY")).toBe(true);
  });

  it("flags stock derivatives as non-index", () => {
    expect(isIndexSymbol("RELIANCE")).toBe(false);
    expect(isIndexSymbol("TCS")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isIndexSymbol("nifty")).toBe(true);
  });
});

// ─── v3 parser ─────────────────────────────────────────────────────────────

describe("parseOptionChainV3", () => {
  let chain: FOChainData;

  beforeEach(() => {
    chain = parseOptionChainV3(v3Sample, "NIFTY");
  });

  it("maps underlying value + timestamp + expiries", () => {
    expect(chain.underlying).toBe("NIFTY");
    expect(chain.underlyingValue).toBe(24435.95);
    expect(chain.timestamp).toMatch(/^2026-08-12T15:40:00/);
    expect(chain.expiries).toEqual([
      "2026-08-18",
      "2026-08-25",
      "2026-09-01",
      "2026-09-29",
    ]);
    expect(chain.strikePrices).toContain(24500);
  });

  it("maps v3 bid/ask fields to FOContract bid/ask", () => {
    const ce = chain.contracts.find((c) => c.type === "CE")!;
    expect(ce.bidPrice).toBe(117.75);
    expect(ce.bidQty).toBe(900);
    expect(ce.askPrice).toBe(118.85);
    expect(ce.askQty).toBe(600);
  });

  it("maps volume, OI, OI-change and new v3 fields", () => {
    const ce = chain.contracts.find((c) => c.type === "CE")!;
    expect(ce.volume).toBe(21566918);
    expect(ce.openInterest).toBe(1918926);
    expect(ce.changeinOpenInterest).toBe(163275);
    expect(ce.pchangeinOpenInterest).toBe(9.3);
    expect(ce.totalBuyQuantity).toBe(900);
    expect(ce.totalSellQuantity).toBe(600);
    expect(ce.impliedVolatility).toBe(10.26);
    expect(ce.lastPrice).toBe(117.75);
  });

  it("normalizes per-side expiryDate to ISO", () => {
    for (const c of chain.contracts) {
      expect(c.expiry).toBe("2026-08-18");
    }
  });

  it("skips empty {} CE/PE contracts (unquoted strikes)", () => {
    expect(chain.contracts.length).toBe(2); // only the 24500 CE + PE
    expect(chain.contracts.filter((c) => c.strike === 24600).length).toBe(0);
  });

  it("extracts per-side totals from records.filtered", () => {
    expect(chain.filtered.CE.totOI).toBe(1918926);
    expect(chain.filtered.CE.totVol).toBe(21566918);
    expect(chain.filtered.PE.totOI).toBe(1046000);
    expect(chain.filtered.PE.totVol).toBe(8923411);
  });

  it("falls back to safe defaults when filtered totals missing", () => {
    const bare = parseOptionChainV3({ records: { data: [] } }, "NIFTY");
    expect(bare.filtered.CE.totOI).toBe(0);
    expect(bare.filtered.PE.totVol).toBe(0);
    expect(bare.contracts).toEqual([]);
    expect(bare.expiries).toEqual([]);
  });
});

// ─── fetchOptionChain URL building + fallback ─────────────────────────────

describe("fetchOptionChain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds v3 URL with type=Indices and no expiry for index symbols", async () => {
    mockedNseFetch.mockResolvedValueOnce(v3Sample);
    const chain = await fetchOptionChain("NIFTY");
    expect(mockedNseFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/option-chain-v3?type=Indices&symbol=NIFTY")
    );
    expect(chain.contracts.length).toBe(2);
  });

  it("builds v3 URL with type=Stocks for stock symbols", async () => {
    mockedNseFetch.mockResolvedValueOnce(v3Sample);
    await fetchOptionChain("RELIANCE");
    expect(mockedNseFetch).toHaveBeenCalledWith(
      expect.stringContaining("type=Stocks&symbol=RELIANCE")
    );
  });

  it("appends expiry param as DD-MMM-YYYY when provided", async () => {
    mockedNseFetch.mockResolvedValueOnce(v3Sample);
    await fetchOptionChain("NIFTY", "2026-08-18");
    expect(mockedNseFetch).toHaveBeenCalledWith(
      expect.stringContaining("expiry=18-Aug-2026")
    );
  });

  it("returns fallback chain when NSE returns no data", async () => {
    mockedNseFetch.mockResolvedValueOnce(null);
    const chain = await fetchOptionChain("NIFTY");
    expect(chain.contracts).toEqual([]);
    expect(chain.filtered.CE.totOI).toBe(0);
    expect(chain.underlying).toBe("NIFTY");
  });

  it("returns fallback chain when fetch throws", async () => {
    mockedNseFetch.mockRejectedValueOnce(new Error("NSE down"));
    const chain = await fetchOptionChain("NIFTY");
    expect(chain.contracts).toEqual([]);
    expect(chain.expiries).toEqual([]);
  });
});

describe("fetchExpiries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("derives expiries from the chain with weekly flags for indices", async () => {
    mockedNseFetch.mockResolvedValueOnce(v3Sample);
    const expiries = await fetchExpiries("NIFTY");
    expect(expiries.length).toBe(4);
    expect(expiries[0].symbol).toBe("NIFTY");
    expect(expiries[0].expiryDate).toMatch(/^2026-08-18/);
    expect(expiries[0].weekly).toBe(true);
  });

  it("flags stock expiries as non-weekly", async () => {
    mockedNseFetch.mockResolvedValueOnce(v3Sample);
    const expiries = await fetchExpiries("RELIANCE");
    expect(expiries.every((e) => e.weekly === false)).toBe(true);
  });

  it("returns [] when the chain fetch fails", async () => {
    mockedNseFetch.mockRejectedValueOnce(new Error("NSE down"));
    const expiries = await fetchExpiries("NIFTY");
    expect(expiries).toEqual([]);
  });
});
