// lib/__tests__/symbolReference.test.ts
//
// Pure wiring-layer tests for the NSE scrip-list constant consumers:
//   - mergeSymbolSuggestions (used by /api/symbols/search autocomplete)
//
// The v3.28.5 `isBacktestSymbolAllowed` gate tests were removed with the
// v3.29.0 backtest softening (the route no longer 404s on symbol presence).

import { mergeSymbolSuggestions } from "@/lib/services/symbolReference";

const scrip = (symbol: string) => ({
  symbol,
  companyName: `${symbol} LIMITED`,
  series: "EQ" as const,
  dateOfListing: "01-JAN-2000",
  paidUpValue: 5,
  marketLot: 1,
  isin: "IN0000000000",
  faceValue: 10,
});

describe("mergeSymbolSuggestions", () => {
  it("returns constant matches first (symbol-prefix priority), then DB rows", () => {
    const constant = [scrip("INFY"), scrip("INFIBEAM")];
    const db = [{ symbol: "INFOCOM", companyName: "InfoCom Systems" }];
    const out = mergeSymbolSuggestions(constant, db);
    expect(out.map((s) => s.symbol)).toEqual(["INFY", "INFIBEAM", "INFOCOM"]);
  });

  it("dedupes by symbol — constant wins over the DB row", () => {
    const constant = [scrip("INFY")];
    const db = [{ symbol: "infy", companyName: "DB Variant" }];
    const out = mergeSymbolSuggestions(constant, db);
    expect(out).toEqual([{ symbol: "INFY", companyName: "INFY LIMITED" }]);
  });

  it("returns constant-only results when DB is empty", () => {
    const out = mergeSymbolSuggestions([scrip("TCS")], []);
    expect(out).toEqual([{ symbol: "TCS", companyName: "TCS LIMITED" }]);
  });

  it("returns DB-only results when constant is empty (legacy path)", () => {
    const db = [{ symbol: "SOMECO", companyName: "Some Co" }];
    const out = mergeSymbolSuggestions([], db);
    expect(out).toEqual([{ symbol: "SOMECO", companyName: "Some Co" }]);
  });

  it("returns empty when both sources are empty", () => {
    expect(mergeSymbolSuggestions([], [])).toEqual([]);
  });

  it("caps results at the requested limit", () => {
    const constant = [scrip("A"), scrip("B"), scrip("C")];
    const db = [{ symbol: "D", companyName: "D" }];
    const out = mergeSymbolSuggestions(constant, db, 3);
    expect(out.map((s) => s.symbol)).toEqual(["A", "B", "C"]);
  });

  it("normalizes lowercase DB symbols to uppercase", () => {
    const db = [{ symbol: "  azure  ", companyName: "Azure" }];
    const out = mergeSymbolSuggestions([], db);
    expect(out[0].symbol).toBe("AZURE");
  });
});