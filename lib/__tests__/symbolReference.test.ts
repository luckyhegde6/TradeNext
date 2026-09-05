// lib/__tests__/symbolReference.test.ts
//
// Pure wiring-layer tests for the NSE scrip-list constant consumers:
//   - mergeSymbolSuggestions  (used by /api/symbols/search autocomplete)
//   - isBacktestSymbolAllowed (used by /api/backtest/run gate)

import {
  mergeSymbolSuggestions,
  isBacktestSymbolAllowed,
} from "@/lib/services/symbolReference";
import { NSE_SCRIP_BY_SYMBOL } from "@/lib/services/nseScripList";

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

describe("isBacktestSymbolAllowed", () => {
  it("allows any DB-recorded symbol regardless of the scrip list", () => {
    expect(isBacktestSymbolAllowed("QQQXYZ", true)).toBe(true);
  });

  it("allows a valid NSE scrip without a DB record (unlisted/synced-later)", () => {
    // RELIANCE is in the committed scrip constant — real dataset sanity check.
    expect(NSE_SCRIP_BY_SYMBOL["RELIANCE"]).toBeDefined();
    expect(isBacktestSymbolAllowed("RELIANCE", false)).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isBacktestSymbolAllowed("reliance", false)).toBe(true);
    expect(isBacktestSymbolAllowed("  RELIANCE  ", false)).toBe(true);
  });

  it("rejects an unknown symbol with no DB record (404 fall-through stays)", () => {
    expect(isBacktestSymbolAllowed("QQQXYZ", false)).toBe(false);
    expect(isBacktestSymbolAllowed("NOT-A-REAL-SCRIP12", false)).toBe(false);
  });
});