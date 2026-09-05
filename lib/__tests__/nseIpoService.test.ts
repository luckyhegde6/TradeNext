/**
 * Tests for lib/services/nseIpoService.ts (v3.6.3).
 *
 * Covers parsing of the NSE `/api/all-upcoming-issues?category=ipo` payload
 * and that the service routes through the shared getOrFetchSyncedData chain:
 *   - valid rows are filtered and returned with source=api, DB synced
 *   - junk rows are dropped by the isIpoIssue guard
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

jest.mock("@/lib/nse-client", () => ({
  __esModule: true,
  nseFetch: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  getUpcomingIpoIssues,
  getIpoIssueDetail,
  parseSharesPerLot,
  parsePriceBandLow,
  perLotInvestment,
  formatIssueSize,
} from "@/lib/services/nseIpoService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nseFetch } = require("@/lib/nse-client") as { nseFetch: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  marketCache: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

const nseIpoRow = {
  companyName: "Shiprocket Limited",
  issueEndDate: "14-Aug-2026",
  issuePrice: "Rs.92 to Rs.97",
  issueSize: "94436030",
  issueStartDate: "12-Aug-2026",
  series: "EQ",
  status: "Active",
  symbol: "SHIPROCKET",
  lotSize: "31",
  priceBand: "Rs.92 to Rs.97",
};

const nseIpoRow2 = {
  companyName: "Northern Arc Capital",
  issueEndDate: "15-Aug-2026",
  issuePrice: "Rs.250",
  issueSize: "99999999",
  issueStartDate: "13-Aug-2026",
  series: "SME",
  status: "Forthcoming",
  symbol: "NACL",
};

describe("getUpcomingIpoIssues", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nseFetch.mockResolvedValue([nseIpoRow, nseIpoRow2]);
    prisma.marketCache.findUnique.mockResolvedValue(null);
    prisma.marketCache.upsert.mockResolvedValue({});
  });

  it("fetches from NSE, filters valid rows and syncs the DB", async () => {
    const res = await getUpcomingIpoIssues();

    expect(nseFetch).toHaveBeenCalledWith(
      "https://www.nseindia.com/api/all-upcoming-issues",
      "?category=ipo"
    );
    expect(res).toMatchObject({
      data: [nseIpoRow, nseIpoRow2],
      source: "api",
      changed: true,
    });
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
    const { create } = prisma.marketCache.upsert.mock.calls[0][0];
    expect(create.cacheKey).toBe("nse_upcoming_ipo_issues");
    expect(create.dataType).toBe("ipo_upcoming");
    expect(create.recordCount).toBe(2);
  });

  it("drops junk rows that fail the isIpoIssue guard", async () => {
    nseFetch.mockResolvedValue([
      nseIpoRow,
      { foo: "bar" }, // missing required fields
      null,
      42,
      nseIpoRow2,
    ]);

    const res = await getUpcomingIpoIssues();
    // Each surviving row is now enriched with the `listed` flag (v3.28.5):
    // SHIPROCKET is in the committed scrip list, NACL (SME) is not.
    expect(res.data).toEqual([
      { ...nseIpoRow, listed: true },
      { ...nseIpoRow2, listed: false },
    ]);
    expect(res.changed).toBe(true);
  });

  it("non-array NSE payload is treated as no data (not a crash)", async () => {
    nseFetch.mockResolvedValue({ error: "nope" });

    const res = await getUpcomingIpoIssues();
    expect(res.data).toEqual([]);
    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
    const { create } = prisma.marketCache.upsert.mock.calls[0][0];
    expect(create.recordCount).toBe(0);
  });

  it("API failure with a persisted DB row falls back to the DB", async () => {
    nseFetch.mockRejectedValue(new Error("NSE down"));
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "nse_upcoming_ipo_issues",
      data: [nseIpoRow],
      lastSyncedAt: new Date("2026-08-11T10:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T08:00:00.000Z"),
    });

    const res = await getUpcomingIpoIssues();
    expect(res).toMatchObject({ data: [nseIpoRow], source: "db", changed: false });
  });
});

// ─── Per-issue detail (Bid Lot → Issue Size) ──────────────────────────────

describe("parseSharesPerLot / parsePriceBandLow / perLotInvestment / formatIssueSize", () => {
  it("parses the bid-lot share count out of NSE wording", () => {
    expect(parseSharesPerLot("154 Equity Shares and in multiples thereof")).toBe(154);
    expect(parseSharesPerLot("600 Equity Shares")).toBe(600);
    expect(parseSharesPerLot("1,000")).toBe(1000);
    expect(parseSharesPerLot("Not available")).toBeNull();
    expect(parseSharesPerLot(undefined)).toBeNull();
  });

  it("parses the lower end of NSE price range variants", () => {
    expect(parsePriceBandLow("Rs. 92 to Rs. 97 per Equity Share")).toBe(92);
    expect(parsePriceBandLow("Rs. 92 - 97")).toBe(92);
    expect(parsePriceBandLow("92-97")).toBe(92);
    expect(parsePriceBandLow("₹92")).toBe(92);
    expect(parsePriceBandLow("")).toBeNull();
  });

  it("computes per-lot investment as shares × low band", () => {
    expect(perLotInvestment({ sharesPerLot: 154, priceRange: "Rs. 92 to Rs. 97" })).toBe(14168);
    expect(perLotInvestment({ sharesPerLot: null, priceRange: "Rs. 92 to Rs. 97" })).toBeNull();
    expect(perLotInvestment({ sharesPerLot: 154, priceRange: "" })).toBeNull();
  });

  it("formats the Issue Size string", () => {
    expect(
      formatIssueSize({ sharesPerLot: 154, priceRange: "Rs. 92 to Rs. 97" })
    ).toBe("154 shares per lot · ₹14,168 per lot");
    expect(formatIssueSize({ sharesPerLot: 154, priceRange: null })).toBe("154 shares per lot");
    expect(formatIssueSize(null)).toBe("");
    expect(formatIssueSize({ issueSizeText: "₹485.00 Cr" })).toBe("₹485.00 Cr");
  });
});

describe("getIpoIssueDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nseFetch.mockResolvedValue({
      issueInfo: {
        dataList: [
          { title: "Symbol", value: "SHIPROCKET" },
          { title: "Bid Lot", value: "154 Equity Shares and in multiples thereof" },
          { title: "Issue Size", value: "₹8,855 mn Fresh + ₹1,385 mn OFS" },
          { title: "Price Range", value: "Rs. 92 to Rs. 97 per Equity Share" },
        ],
      },
    });
    prisma.marketCache.findUnique.mockResolvedValue(null);
    prisma.marketCache.upsert.mockResolvedValue({});
  });

  it("fetches per-symbol detail, parses bid lot + price band, syncs DB", async () => {
    const res = await getIpoIssueDetail("SHIPROCKET");

    expect(nseFetch).toHaveBeenCalledWith(
      "https://www.nseindia.com/api/ipo-detail?symbol=SHIPROCKET"
    );
    expect(res.source).toBe("api");
    expect(res.data).toMatchObject({
      symbol: "SHIPROCKET",
      companyName: "SHIPROCKET",
      bidLot: "154 Equity Shares and in multiples thereof",
      sharesPerLot: 154,
      priceRange: "Rs. 92 to Rs. 97 per Equity Share",
    });

    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
    const { create } = prisma.marketCache.upsert.mock.calls[0][0];
    expect(create.cacheKey).toBe("nse_ipo_detail_SHIPROCKET");
    expect(create.dataType).toBe("ipo_detail");
  });

  it("treats a missing/invalid detail payload as no-data (not a crash)", async () => {
    nseFetch.mockResolvedValue(null);
    const res = await getIpoIssueDetail("NOPE");
    expect(res.data).toMatchObject({ symbol: "NOPE", sharesPerLot: null });
  });

  it("API failure with a persisted DB row falls back to the DB", async () => {
    nseFetch.mockRejectedValue(new Error("NSE down"));
    const persisted = {
      symbol: "SHIPROCKET",
      companyName: "SHIPROCKET",
      bidLot: "154 Equity Shares",
      sharesPerLot: 154,
      issueSizeText: "₹10,240 mn",
      priceRange: "Rs. 92 to Rs. 97",
      faceValue: "₹10",
      issuePeriod: "12 Aug 2026 - 14 Aug 2026",
      registrar: "KFin Technologies",
    };
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "nse_ipo_detail_SHIPROCKET",
      data: persisted,
      lastSyncedAt: new Date("2026-08-11T10:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T08:00:00.000Z"),
    });

    const res = await getIpoIssueDetail("SHIPROCKET");
    expect(res).toMatchObject({ data: persisted, source: "db", changed: false });
  });
});

// ─── Scrip-list enrichment (`listed` flag from the committed NSE constant) ──
// v3.28.5 consumer wiring: every issue row gains `listed` (tradeable-now flag)
// resolved from the committed scrip reference via `getNseScrip` — NOT from NSE.

describe("getUpcomingIpoIssues — scrip-list enrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.marketCache.findUnique.mockResolvedValue(null);
    prisma.marketCache.upsert.mockResolvedValue({});
  });

  it("tags a listed symbol (present in the scrip constant) as listed: true", async () => {
    // RELIANCE is in the committed scrip constant (real dataset sanity check).
    nseFetch.mockResolvedValue([{ ...nseIpoRow, symbol: "RELIANCE" }]);

    const res = await getUpcomingIpoIssues(true);

    expect(res.data).toHaveLength(1);
    expect(res.data[0].symbol).toBe("RELIANCE");
    expect(res.data[0].listed).toBe(true);
  });

  it("tags a brand-new (not yet in the scrip list) symbol as listed: false", async () => {
    nseFetch.mockResolvedValue([{ ...nseIpoRow, symbol: "NEWIPOXYZ" }]);

    const res = await getUpcomingIpoIssues(true);

    expect(res.data[0].listed).toBe(false);
  });

  it("is case-insensitive and trims the symbol before lookup", async () => {
    nseFetch.mockResolvedValue([
      { ...nseIpoRow, symbol: "  reliance  " },
      { ...nseIpoRow2, symbol: "" },
    ]);

    const res = await getUpcomingIpoIssues(true);

    expect(res.data[0].listed).toBe(true); // "  reliance  " → RELIANCE
    expect(res.data[1].listed).toBe(false); // empty symbol → false
  });

  it("attaches listed to every mapped row (no rows dropped by enrichment)", async () => {
    nseFetch.mockResolvedValue([
      { ...nseIpoRow, symbol: "RELIANCE" },
      { ...nseIpoRow, symbol: "NEWIPOXYZ" },
      { ...nseIpoRow2, symbol: "TCS" },
    ]);

    const res = await getUpcomingIpoIssues(true);

    expect(res.data.map((r) => r.listed)).toEqual([true, false, true]);
  });
});