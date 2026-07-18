import { evaluateFilterGroup, evaluateCondition, applyFilterGroup, validateFilterGroup, evaluateWithDetails } from "../filter-engine";
import { createDefaultFilterGroup } from "../condition-tree";
import type { FilterGroup, FilterCondition } from "../condition-tree";

// ============================================================
// Helpers
// ============================================================

function mockStock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    close: 2500,
    change: 50,
    change_percent: 2.04,
    volume: 5000000,
    market_cap_basic: 15000000000000,
    price_earnings_ttm: 28.5,
    price_book_ratio: 3.2,
    dividend_yield_recent: 0.8,
    sector: "Energy",
    industry: "Refineries",
    RSI: 65,
    "MACD.macd": 12.5,
    "MACD.signal": 10.2,
    SMA50: 2400,
    SMA200: 2200,
    relative_volume_10d_calc: 1.5,
    ...overrides,
  };
}

// ============================================================
// evaluateCondition
// ============================================================

describe("evaluateCondition", () => {
  it("gt: returns true when field value > threshold", () => {
    const condition: FilterCondition = {
      id: "1",
      field: "close",
      condition: { operator: "gt", value: 2000 },
    };
    expect(evaluateCondition(condition, mockStock())).toBe(true);
  });

  it("gt: returns false when field value <= threshold", () => {
    const condition: FilterCondition = {
      id: "1",
      field: "close",
      condition: { operator: "gt", value: 3000 },
    };
    expect(evaluateCondition(condition, mockStock())).toBe(false);
  });

  it("gte: returns true when field value >= threshold", () => {
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "gte", value: 2500 } },
      mockStock()
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "gte", value: 2499 } },
      mockStock()
    )).toBe(true);
  });

  it("lt / lte: works correctly", () => {
    const stock = mockStock();
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "lt", value: 3000 } },
      stock
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "lt", value: 2000 } },
      stock
    )).toBe(false);
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "lte", value: 2500 } },
      stock
    )).toBe(true);
  });

  it("eq / neq: works with numeric values", () => {
    const stock = mockStock({ close: 2500 });
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "eq", value: 2500 } },
      stock
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "neq", value: 2500 } },
      stock
    )).toBe(false);
  });

  it("between: returns true when value is within range", () => {
    const stock = mockStock({ close: 2500 });
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "between", value: 2000, value2: 3000 } },
      stock
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "close", condition: { operator: "between", value: 2600, value2: 3000 } },
      stock
    )).toBe(false);
  });

  it("string eq/neq/in/not_in: works with sector field", () => {
    const stock = mockStock({ sector: "Energy" });
    expect(evaluateCondition(
      { id: "1", field: "sector", condition: { operator: "eq", value: "Energy" } },
      stock
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "sector", condition: { operator: "neq", value: "Technology" } },
      stock
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "sector", condition: { operator: "in", value: ["Energy", "Technology"] } },
      stock
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "sector", condition: { operator: "not_in", value: ["Technology", "Healthcare"] } },
      stock
    )).toBe(true);
  });

  it("resolves dot-notation fields like MACD.macd", () => {
    const stock = mockStock();
    expect(evaluateCondition(
      { id: "1", field: "MACD.macd", condition: { operator: "gt", value: 10 } },
      stock
    )).toBe(true);
    expect(evaluateCondition(
      { id: "1", field: "MACD.macd", condition: { operator: "lt", value: 10 } },
      stock
    )).toBe(false);
  });

  it("returns false for undefined fields", () => {
    const stock = mockStock();
    expect(evaluateCondition(
      { id: "1", field: "nonexistent_field", condition: { operator: "gt", value: 10 } },
      stock
    )).toBe(false);
  });
});

// ============================================================
// evaluateFilterGroup
// ============================================================

describe("evaluateFilterGroup", () => {
  it("AND group: all conditions must pass", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "gt", value: 2000 } },
        { id: "c2", field: "RSI", condition: { operator: "lt", value: 80 } },
      ],
      groups: [],
    };
    expect(evaluateFilterGroup(group, mockStock())).toBe(true);
  });

  it("AND group: returns false when one condition fails", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "gt", value: 2000 } },
        { id: "c2", field: "RSI", condition: { operator: "gt", value: 70 } }, // RSI is 65
      ],
      groups: [],
    };
    expect(evaluateFilterGroup(group, mockStock())).toBe(false);
  });

  it("OR group: returns true if any condition passes", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "OR",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "gt", value: 10000 } }, // Fails
        { id: "c2", field: "RSI", condition: { operator: "gt", value: 60 } }, // Passes
      ],
      groups: [],
    };
    expect(evaluateFilterGroup(group, mockStock())).toBe(true);
  });

  it("OR group: returns false when all conditions fail", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "OR",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "lt", value: 100 } },
        { id: "c2", field: "RSI", condition: { operator: "lt", value: 10 } },
      ],
      groups: [],
    };
    expect(evaluateFilterGroup(group, mockStock())).toBe(false);
  });

  it("empty group returns true", () => {
    const group: FilterGroup = { id: "g1", logic: "AND", conditions: [], groups: [] };
    expect(evaluateFilterGroup(group, mockStock())).toBe(true);
  });
});

// ============================================================
// Nested groups
// ============================================================

describe("evaluateFilterGroup with nested groups", () => {
  it("(A AND B) OR (C AND D) — both groups true", () => {
    const group: FilterGroup = {
      id: "root",
      logic: "OR",
      conditions: [],
      groups: [
        {
          id: "g1",
          logic: "AND",
          conditions: [
            { id: "c1", field: "close", condition: { operator: "gt", value: 2000 } },
            { id: "c2", field: "volume", condition: { operator: "gt", value: 1000000 } },
          ],
          groups: [],
        },
        {
          id: "g2",
          logic: "AND",
          conditions: [
            { id: "c3", field: "RSI", condition: { operator: "gt", value: 50 } },
            { id: "c4", field: "dividend_yield_recent", condition: { operator: "gt", value: 0.5 } },
          ],
          groups: [],
        },
      ],
    };
    expect(evaluateFilterGroup(group, mockStock())).toBe(true);
  });

  it("(A AND B) OR (C AND D) — one group false, other true", () => {
    const group: FilterGroup = {
      id: "root",
      logic: "OR",
      conditions: [],
      groups: [
        {
          id: "g1",
          logic: "AND",
          conditions: [
            { id: "c1", field: "close", condition: { operator: "lt", value: 100 } }, // Fails
            { id: "c2", field: "volume", condition: { operator: "gt", value: 1000000 } },
          ],
          groups: [],
        },
        {
          id: "g2",
          logic: "AND",
          conditions: [
            { id: "c3", field: "RSI", condition: { operator: "gt", value: 50 } },
            { id: "c4", field: "volume", condition: { operator: "gt", value: 1000000 } },
          ],
          groups: [],
        },
      ],
    };
    expect(evaluateFilterGroup(group, mockStock())).toBe(true);
  });
});

// ============================================================
// applyFilterGroup (batch)
// ============================================================

describe("applyFilterGroup", () => {
  const stocks = [
    mockStock({ symbol: "RELIANCE", close: 2500, RSI: 65 }),
    mockStock({ symbol: "TCS", close: 3500, RSI: 55 }),
    mockStock({ symbol: "INFY", close: 1500, RSI: 70 }),
    mockStock({ symbol: "HDFC", close: 600, RSI: 45 }),
  ];

  it("filters stocks by condition", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [{ id: "c1", field: "close", condition: { operator: "gt", value: 2000 } }],
      groups: [],
    };
    const result = applyFilterGroup(group, stocks);
    expect(result.total).toBe(2);
    expect(result.stocks.map((s) => s.symbol)).toEqual(["RELIANCE", "TCS"]);
  });

  it("sorts descending by default", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [{ id: "c1", field: "close", condition: { operator: "gt", value: 0 } }],
      groups: [],
    };
    const result = applyFilterGroup(group, stocks, { sortBy: "close", sortOrder: "desc" });
    expect(result.stocks[0].symbol).toBe("TCS"); // 3500 — highest
    expect(result.stocks[3].symbol).toBe("HDFC"); // 600 — lowest
  });

  it("supports pagination with offset/limit", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [{ id: "c1", field: "close", condition: { operator: "gt", value: 0 } }],
      groups: [],
    };
    const result = applyFilterGroup(group, stocks, { offset: 1, limit: 2 });
    expect(result.total).toBe(4);
    expect(result.stocks.length).toBe(2);
  });
});

// ============================================================
// validateFilterGroup
// ============================================================

describe("validateFilterGroup", () => {
  it("returns empty for valid group", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [{ id: "c1", field: "close", condition: { operator: "gt", value: 100 } }],
      groups: [],
    };
    expect(validateFilterGroup(group)).toEqual([]);
  });

  it("returns error for unknown field", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [{ id: "c1", field: "nonexistent", condition: { operator: "gt", value: 100 } }],
      groups: [],
    };
    const errors = validateFilterGroup(group);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("nonexistent");
  });

  it("returns error for invalid between range", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [{
        id: "c1",
        field: "close",
        condition: { operator: "between" as const, value: 100, value2: 50 }
      }],
      groups: [],
    };
    const errors = validateFilterGroup(group);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ============================================================
// evaluateWithDetails
// ============================================================

describe("evaluateWithDetails", () => {
  it("returns matched and failed condition IDs", () => {
    const group: FilterGroup = {
      id: "g1",
      logic: "AND",
      conditions: [
        { id: "c1", field: "close", condition: { operator: "gt", value: 2000 } },
        { id: "c2", field: "RSI", condition: { operator: "gt", value: 70 } }, // Fails (RSI=65)
      ],
      groups: [],
    };
    const result = evaluateWithDetails(group, mockStock());
    expect(result.passed).toBe(false);
    expect(result.matchedConditions).toContain("c1");
    expect(result.failedConditions).toContain("c2");
  });
});

// ============================================================
// createDefaultFilterGroup
// ============================================================

describe("createDefaultFilterGroup", () => {
  it("creates a valid AND group with one condition", () => {
    const group = createDefaultFilterGroup();
    expect(group.logic).toBe("AND");
    expect(group.conditions.length).toBe(1);
    expect(group.conditions[0].field).toBe("close");
    expect(group.groups).toEqual([]);
  });
});
