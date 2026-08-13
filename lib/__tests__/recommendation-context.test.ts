/**
 * Tests for recommendation-context (v3.6.1) — per-symbol fundamental
 * enrichment for the recommendation agent: corporate actions + announcements
 * (batched DB) and quarterly results (single cached NSE call).
 *
 * Covers:
 *   - getRecommendationContext(): batched findMany per source, per-symbol
 *     caps, symbol normalization, empty symbol-list short-circuit
 *   - Graceful fallback: any source failure drops only that source
 *   - formatStockContext(): compact prompt block rendering
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/index-service", () => ({
  __esModule: true,
  getCorporateResults: jest.fn(async () => []),
}));

jest.mock("@/lib/prisma", () => {
  const mock = {
    corporateAction: { findMany: jest.fn() },
    corporateAnnouncement: { findMany: jest.fn() },
  };
  return { __esModule: true, default: mock };
});

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  getRecommendationContext,
  formatStockContext,
  type StockContext,
} from "@/lib/services/ai/recommendation-context";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  corporateAction: { findMany: jest.Mock };
  corporateAnnouncement: { findMany: jest.Mock };
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getCorporateResults } = require("@/lib/index-service") as {
  getCorporateResults: jest.Mock;
};

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "RELIANCE",
    actionType: "DIVIDEND",
    subject: "Interim Dividend Rs.10/-",
    exDate: new Date("2026-08-20T00:00:00.000Z"),
    ratio: null,
    ...overrides,
  };
}

function makeAnnouncement(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "RELIANCE",
    subject: "Board meeting to consider results",
    broadcastDateTime: new Date("2026-08-10T08:00:00.000Z"),
    ...overrides,
  };
}

describe("recommendation-context", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.corporateAction.findMany.mockReset();
    prisma.corporateAnnouncement.findMany.mockReset();
    getCorporateResults.mockReset();
    getCorporateResults.mockResolvedValue([]);
  });

  describe("getRecommendationContext", () => {
    it("returns an empty map for an empty symbol list without querying", async () => {
      const map = await getRecommendationContext([]);
      expect(map).toEqual({});
      expect(prisma.corporateAction.findMany).not.toHaveBeenCalled();
      expect(prisma.corporateAnnouncement.findMany).not.toHaveBeenCalled();
      expect(getCorporateResults).not.toHaveBeenCalled();
    });

    it("batches DB lookups with symbol IN (...) and keys by caller casing", async () => {
      prisma.corporateAction.findMany.mockResolvedValue([makeAction()]);
      prisma.corporateAnnouncement.findMany.mockResolvedValue([makeAnnouncement()]);
      getCorporateResults.mockResolvedValue([
        { symbol: "RELIANCE", period: "Quarterly", sales: 200000000, np: 18000000, yoy: 12.5, qoq: 3.2 },
      ]);

      const map = await getRecommendationContext(["reliance", "TCS"]);

      // Both sources queried once, uppercased
      const actionQuery = prisma.corporateAction.findMany.mock.calls[0][0];
      expect(actionQuery.where.symbol.in).toEqual(["RELIANCE", "TCS"]);
      const annQuery = prisma.corporateAnnouncement.findMany.mock.calls[0][0];
      expect(annQuery.where.symbol.in).toEqual(["RELIANCE", "TCS"]);

      // Keyed by the caller's original casing
      expect(map["reliance"]).toBeDefined();
      const ctx = map["reliance"];
      expect(ctx.corporateActions).toHaveLength(1);
      expect(ctx.corporateActions[0].actionType).toBe("DIVIDEND");
      expect(ctx.corporateActions[0].exDate).toBe("2026-08-20T00:00:00.000Z");
      expect(ctx.announcements).toHaveLength(1);
      expect(ctx.announcements[0].subject).toContain("Board meeting");
      expect(ctx.financialResults).toHaveLength(1);
      expect(ctx.financialResults[0].yoy).toBe(12.5);

      // Symbol with no data is absent
      expect(map["TCS"]).toBeUndefined();

      // NSE results fetched exactly ONCE for the whole batch
      expect(getCorporateResults).toHaveBeenCalledTimes(1);
    });

    it("caps the number of actions / announcements per symbol", async () => {
      const manyActions = Array.from({ length: 6 }, (_, i) =>
        makeAction({ subject: `Action ${i}`, exDate: new Date(`2026-08-${10 + i}`) }),
      );
      const manyAnnouncements = Array.from({ length: 4 }, (_, i) =>
        makeAnnouncement({ subject: `Announcement ${i}` }),
      );
      prisma.corporateAction.findMany.mockResolvedValue(manyActions);
      prisma.corporateAnnouncement.findMany.mockResolvedValue(manyAnnouncements);

      const map = await getRecommendationContext(["RELIANCE"]);

      expect(map["RELIANCE"].corporateActions).toHaveLength(3); // MAX_ACTIONS_PER_SYMBOL
      expect(map["RELIANCE"].announcements).toHaveLength(2); // MAX_ANNOUNCEMENTS_PER_SYMBOL
    });

    it("drops only the failing source and keeps the rest (graceful fallback)", async () => {
      prisma.corporateAction.findMany.mockRejectedValue(new Error("db down"));
      prisma.corporateAnnouncement.findMany.mockResolvedValue([makeAnnouncement()]);
      getCorporateResults.mockRejectedValue(new Error("nse down"));

      const map = await getRecommendationContext(["RELIANCE"]);

      // Actions + results lost, announcements survive — and no throw
      expect(map["RELIANCE"].corporateActions).toEqual([]);
      expect(map["RELIANCE"].announcements).toHaveLength(1);
      expect(map["RELIANCE"].financialResults).toEqual([]);
    });

    it("never throws even when every source fails", async () => {
      prisma.corporateAction.findMany.mockRejectedValue(new Error("boom"));
      prisma.corporateAnnouncement.findMany.mockRejectedValue(new Error("boom"));
      getCorporateResults.mockRejectedValue(new Error("boom"));

      await expect(getRecommendationContext(["RELIANCE"])).resolves.toEqual({});
    });
  });

  describe("formatStockContext", () => {
    it("renders a compact multi-line prompt block", () => {
      const ctx: StockContext = {
        corporateActions: [
          { actionType: "DIVIDEND", subject: "Interim Dividend Rs.10/-", exDate: "2026-08-20T00:00:00.000Z", ratio: null },
        ],
        announcements: [
          { subject: "Board meeting to consider results", broadcastDateTime: "2026-08-10T08:00:00.000Z" },
        ],
        financialResults: [
          { period: "Quarterly", revenue: 100000000, netProfit: 9000000, yoy: 8.5, qoq: 1.2 },
        ],
      };

      const block = formatStockContext("RELIANCE", ctx);

      expect(block).toContain("Corporate actions:");
      expect(block).toContain("DIVIDEND: Interim Dividend Rs.10/- (ex-date 2026-08-20)");
      expect(block).toContain("Recent announcements:");
      expect(block).toContain("Latest quarterly results:");
      expect(block).toContain("revenue ₹10.00 Cr");
      expect(block).toContain("net profit ₹0.90 Cr");
    });
  });
});