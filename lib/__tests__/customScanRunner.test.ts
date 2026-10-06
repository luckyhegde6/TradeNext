/* @jest-environment node */
/**
 * `lib/screener/customScanRunner` — the pipeline extracted from
 * `app/api/screener/configs/[id]/run/route.ts` so the Google Sheets console can
 * re-scan a saved config through the same code (Spec 20).
 *
 * The behaviour worth pinning is not "does it filter" (that is filter-engine's
 * job) but the two things a naive extraction gets wrong:
 *
 *  1. The column union. A condition on `RSI` is useless unless `RSI` is REQUESTED
 *     from TradingView. Drop it and the condition evaluates against `undefined`,
 *     which is how a "working" screener silently starts matching the whole market.
 *  2. Filter-then-paginate. If paging happened before filtering, `total` and the
 *     page contents would disagree and a deep page would report a total that
 *     changed as the operator scrolled.
 */
jest.mock("@/lib/screener/condition-tree", () => ({ getRequiredColumns: jest.fn(() => ["RSI"]) }));
jest.mock("@/lib/services/tradingview-service", () => ({
  advancedScan: jest.fn(async () => []),
  DEFAULT_COLUMNS: ["close", "volume"],
}));
jest.mock("@/lib/screener/filter-engine", () => ({ applyFilterGroup: jest.fn() }));

import { getRequiredColumns } from "@/lib/screener/condition-tree";
import { applyFilterGroup } from "@/lib/screener/filter-engine";
import { advancedScan } from "@/lib/services/tradingview-service";
import { asFilterGroup, fetchUniverseForFilter, runCustomScan } from "@/lib/screener/customScanRunner";

const mockRequired = getRequiredColumns as jest.Mock;
const mockApply = applyFilterGroup as jest.Mock;
const mockScan = advancedScan as jest.Mock;

const GROUP = { logic: "and", conditions: [{ field: "close", op: ">", value: 100 }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockRequired.mockReturnValue(["RSI"]);
  mockScan.mockResolvedValue([{ symbol: "AAA" }, { symbol: "BBB" }]);
  mockApply.mockReturnValue({ stocks: [{ symbol: "AAA" }], total: 1 });
});

describe("asFilterGroup", () => {
  it("passes a real group through", () => {
    expect(asFilterGroup(GROUP)).toBe(GROUP);
  });

  it("rejects null/undefined/non-objects", () => {
    for (const bad of [null, undefined, 42, "x", true]) {
      expect(asFilterGroup(bad)).toBeNull();
    }
  });

  it("rejects a group with no conditions, which would match everything", () => {
    // Without this, a half-written config would scan the entire market and the
    // operator would see a plausible-looking sheet full of non-matches.
    expect(asFilterGroup({ logic: "and" })).toBeNull();
    expect(asFilterGroup({ logic: "and", conditions: "close>100" })).toBeNull();
  });
});

describe("fetchUniverseForFilter", () => {
  it("requests DEFAULT_COLUMNS unioned with the condition columns", async () => {
    await fetchUniverseForFilter(GROUP as never);
    const [, columns] = mockScan.mock.calls[0];
    expect(columns).toEqual(expect.arrayContaining(["close", "volume", "RSI"]));
  });

  it("dedupes a required column that is already a default", async () => {
    mockRequired.mockReturnValue(["close"]);
    await fetchUniverseForFilter(GROUP as never);
    const [, columns] = mockScan.mock.calls[0];
    expect(columns.filter((c: string) => c === "close")).toHaveLength(1);
  });

  it("scans the full universe, unscoped by any filter argument", async () => {
    // A TV-side filter would double-filter and make `total` unverifiable.
    await fetchUniverseForFilter(GROUP as never);
    expect(mockScan).toHaveBeenCalledWith([], expect.any(Array), { from: 0, to: 2000 });
  });

  it("reports scan duration", async () => {
    const res = await fetchUniverseForFilter(GROUP as never);
    expect(res.stocks).toHaveLength(2);
    expect(typeof res.fetchMs).toBe("number");
    expect(res.fetchMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runCustomScan", () => {
  it("returns the filtered page, the full total, and both timings", async () => {
    const res = await runCustomScan({ id: "cfg-1", filters: GROUP });
    expect(res).toMatchObject({ stocks: [{ symbol: "AAA" }], total: 1 });
    expect(res.executionMs).toBeGreaterThanOrEqual(res.fetchMs);
  });

  it("applies the filter to the whole universe and only then paginates", async () => {
    await runCustomScan({ id: "cfg-1", filters: GROUP }, { limit: 25, offset: 50, sortBy: "close" });
    const [, allStocks, options] = mockApply.mock.calls[0];
    // Every fetched stock goes in; the page is produced by applyFilterGroup.
    expect(allStocks).toHaveLength(2);
    expect(options).toMatchObject({ limit: 25, offset: 50, sortBy: "close", sortOrder: "desc" });
  });

  it("defaults to the first 50 rows, newest/highest first", async () => {
    await runCustomScan({ id: "cfg-1", filters: GROUP });
    expect(mockApply.mock.calls[0][2]).toMatchObject({ limit: 50, offset: 0, sortOrder: "desc" });
  });

  it("refuses to scan a config with no usable filter group", async () => {
    await expect(runCustomScan({ id: "cfg-1", filters: { logic: "and" } })).rejects.toThrow(
      /cfg-1 has no usable filter group/,
    );
    expect(mockScan).not.toHaveBeenCalled();
  });
});
