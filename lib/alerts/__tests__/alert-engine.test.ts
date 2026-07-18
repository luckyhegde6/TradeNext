import { evaluateAlertRule } from "../alert-engine";
import type { FilterGroup } from "@/lib/screener/condition-tree";

// ============================================================
// Mock stock data
// ============================================================

function mockStockData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "RELIANCE",
    ticker: "RELIANCE",
    close: 2500,
    lastPrice: 2500,
    open: 2480,
    high: 2520,
    low: 2470,
    change: 50,
    pChange: 2.04,
    percentChange: 2.04,
    volume: 5000000,
    market_cap_basic: 15000000000000,
    price_earnings_ttm: 28.5,
    price_book_ratio: 3.2,
    dividend_yield_recent: 0.8,
    sector: "Energy",
    industry: "Refineries",
    RSI: 65,
    SMA50: 2400,
    SMA200: 2200,
    ...overrides,
  };
}

// ============================================================
// evaluateAlertRule
// ============================================================

describe("evaluateAlertRule", () => {
  it("returns not triggered for inactive rules", async () => {
    const result = await evaluateAlertRule({
      id: "rule-1",
      name: "Inactive Test",
      userId: 1,
      isActive: false,
      condition: { logic: "AND", conditions: [{ id: "c1", field: "close", condition: { operator: "gt", value: 2000 } }], groups: [] },
      channels: [],
      triggerCount: 0,
    });
    expect(result.triggered).toBe(false);
  });

  it("triggers when condition is met with symbol in condition", async () => {
    const condition: any = {
      logic: "AND",
      conditions: [
        { id: "c1", field: "symbol", condition: { operator: "eq", value: "RELIANCE" } },
        { id: "c2", field: "close", condition: { operator: "gt", value: 2000 } },
      ],
      groups: [],
    };
    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "Price Alert",
        userId: 1,
        isActive: true,
        condition,
        channels: [],
        triggerCount: 0,
      },
      mockStockData()
    );
    expect(result.triggered).toBe(true);
    expect(result.symbol).toBe("RELIANCE");
    expect(result.price).toBe(2500);
  });

  it("does not trigger when condition is NOT met", async () => {
    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "Price Alert",
        userId: 1,
        isActive: true,
        condition: { logic: "AND", conditions: [{ id: "c1", field: "close", condition: { operator: "lt", value: 2000 } }], groups: [] },
        channels: [],
        triggerCount: 0,
      },
      mockStockData()
    );
    expect(result.triggered).toBe(false);
  });

  it("triggers on multi-condition AND group when all conditions match", async () => {
    const condition: any = {
      id: "g1",
      logic: "AND",
      conditions: [
        { id: "c1", field: "symbol", condition: { operator: "eq", value: "RELIANCE" } },
        { id: "c2", field: "close", condition: { operator: "gt", value: 2000 } },
        { id: "c3", field: "volume", condition: { operator: "gt", value: 1000000 } },
        { id: "c4", field: "RSI", condition: { operator: "gte", value: 50 } },
      ],
      groups: [],
    };

    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "Multi Condition Alert",
        userId: 1,
        isActive: true,
        condition,
        channels: [],
        triggerCount: 0,
      },
      mockStockData()
    );
    expect(result.triggered).toBe(true);
  });

  it("does not trigger on multi-condition AND when one condition fails", async () => {
    const condition: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "gt", value: 2000 } },
        { id: "c2", field: "volume", condition: { operator: "lt", value: 100000 } }, // volume is 5M, so this fails
      ],
      groups: [],
    };

    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "Failing Multi Condition",
        userId: 1,
        isActive: true,
        condition,
        channels: [],
        triggerCount: 0,
      },
      mockStockData()
    );
    expect(result.triggered).toBe(false);
  });

  it("triggers with OR logic when any condition matches", async () => {
    const condition: FilterGroup = {
      id: "g1",
      logic: "OR",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "gt", value: 3000 } }, // fails (2500 < 3000)
        { id: "c2", field: "RSI", condition: { operator: "gt", value: 60 } },    // passes (65 > 60)
      ],
      groups: [],
    };

    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "OR Logic Alert",
        userId: 1,
        isActive: true,
        condition,
        channels: [],
        triggerCount: 0,
      },
      mockStockData()
    );
    expect(result.triggered).toBe(true);
  });

  it("returns meaningful alert message when triggered without symbol field", async () => {
    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "RSI Oversold",
        userId: 1,
        isActive: true,
        condition: { logic: "AND", conditions: [{ id: "c1", field: "RSI", condition: { operator: "lt", value: 30 } }], groups: [] },
        channels: [],
        triggerCount: 0,
      },
      mockStockData({ RSI: 25 })
    );
    expect(result.triggered).toBe(true);
    // Without a symbol field in condition, the engine falls back to a generic message
    expect(result.message).toBe("Alert condition met");
  });

  it("extracts symbol from condition and builds rich message", async () => {
    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "RSI Oversold",
        userId: 1,
        isActive: true,
        condition: {
          logic: "AND",
          conditions: [
            { id: "c1", field: "symbol" as any, condition: { operator: "eq", value: "RELIANCE" } },
            { id: "c2", field: "RSI", condition: { operator: "lt", value: 30 } },
          ],
          groups: [],
        } as any,
        channels: [],
        triggerCount: 0,
      },
      mockStockData({ RSI: 25 })
    );
    expect(result.triggered).toBe(true);
    expect(result.symbol).toBe("RELIANCE");
    expect(result.message).toContain("RSI Oversold");
    expect(result.message).toContain("RELIANCE");
  });

  it("handles string condition (JSON parse) gracefully", async () => {
    const conditionStr = JSON.stringify({
      logic: "AND",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "gt", value: 2000 } },
      ],
      groups: [],
    });

    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "String Parsed Alert",
        userId: 1,
        isActive: true,
        condition: conditionStr,
        channels: [],
        triggerCount: 0,
      },
      mockStockData()
    );
    expect(result.triggered).toBe(true);
  });

  it("handles invalid condition JSON gracefully", async () => {
    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "Bad Condition",
        userId: 1,
        isActive: true,
        condition: "not-valid-json",
        channels: [],
        triggerCount: 0,
      },
      mockStockData()
    );
    // Should not throw, just return not triggered
    expect(result.triggered).toBe(false);
  });

  it("respects cooldown when lastTriggeredAt is recent", async () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const schedule = {
      activeDays: [new Date().getDay()], // today
      activeHours: { start: "00:00", end: "23:59" }, // all day
      cooldownMinutes: 60, // 60 min cooldown
    };

    const result = await evaluateAlertRule(
      {
        id: "rule-1",
        name: "Cooldown Alert",
        userId: 1,
        isActive: true,
        condition: { logic: "AND", conditions: [{ id: "c1", field: "close", condition: { operator: "gt", value: 2000 } }], groups: [] },
        channels: [],
        schedule,
        triggerCount: 5,
        lastTriggeredAt: recentTime,
      },
      mockStockData()
    );
    // Should not trigger because of cooldown
    expect(result.triggered).toBe(false);
  });
});
