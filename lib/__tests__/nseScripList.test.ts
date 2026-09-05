// lib/__tests__/nseScripList.test.ts
// Sanity + helper coverage for the generated NSE scrip-list constant
// (lib/services/nseScripList.ts — SECURITIES AVAILABLE FOR TRADING, Equity segment).

import {
  NSE_SCRIPS,
  NSE_SYMBOL_SET,
  NSE_SCRIP_BY_SYMBOL,
  isNseSymbol,
  getNseScrip,
  searchNseSymbols,
} from "@/lib/services/nseScripList";

describe("NSE scrip list constant (generated)", () => {
  it("has a healthy dataset size (Equity segment ≈ 2,500+)", () => {
    expect(NSE_SCRIPS.length).toBeGreaterThanOrEqual(2500);
  });

  it("has unique, uppercase, non-empty symbols", () => {
    const symbols = NSE_SCRIPS.map((s) => s.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const s of symbols) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).toBe(s.toUpperCase());
      expect(s).not.toMatch(/\s/);
    }
  });

  it("only contains known NSE series (EQ/BE/BZ)", () => {
    const series = new Set(NSE_SCRIPS.map((s) => s.series));
    expect([...series].sort()).toEqual(["BE", "BZ", "EQ"]);
  });

  it("has well-formed metadata on every row", () => {
    for (const s of NSE_SCRIPS) {
      expect(s.companyName.length).toBeGreaterThan(0);
      expect(s.isin).toMatch(/^IN[0-9A-Z]{10}$/);
      expect(s.dateOfListing).toMatch(/^\d{2}-[A-Z]{3}-\d{4}$/);
      expect(s.paidUpValue).toBeGreaterThan(0);
      expect(s.marketLot).toBeGreaterThan(0);
      expect(s.faceValue).toBeGreaterThan(0);
    }
  });

  it("spot-checks known fixtures against the NSE master list", () => {
    const rel = getNseScrip("RELIANCE");
    expect(rel).toMatchObject({
      companyName: "Reliance Industries Limited",
      series: "EQ",
      isin: "INE002A01018",
      faceValue: 10,
      marketLot: 1,
    });
    expect(getNseScrip("TCS")?.isin).toBe("INE467B01029");
    expect(getNseScrip("INFY")?.companyName).toBe("Infosys Limited");
    expect(getNseScrip("20MICRONS")?.dateOfListing).toBe("06-OCT-2008");
  });
});

describe("derived collections stay consistent", () => {
  it("Set and Record agree with the array", () => {
    expect(NSE_SYMBOL_SET.size).toBe(NSE_SCRIPS.length);
    for (const s of NSE_SCRIPS) {
      expect(NSE_SYMBOL_SET.has(s.symbol)).toBe(true);
      expect(NSE_SCRIP_BY_SYMBOL[s.symbol].isin).toBe(s.isin);
    }
  });
});

describe("isNseSymbol / getNseScrip helpers", () => {
  it("isNseSymbol is case-insensitive and trims", () => {
    expect(isNseSymbol("RELIANCE")).toBe(true);
    expect(isNseSymbol("reliance")).toBe(true);
    expect(isNseSymbol("  TCS ")).toBe(true);
    expect(isNseSymbol("NOTAREALSYM")).toBe(false);
    expect(isNseSymbol("")).toBe(false);
  });

  it("getNseScrip returns undefined for unknown symbols", () => {
    expect(getNseScrip("ZZZZZ")).toBeUndefined();
    expect(getNseScrip("")).toBeUndefined();
  });
});

describe("searchNseSymbols", () => {
  it("prefix search returns symbol-prefix matches sorted by symbol", () => {
    const results = searchNseSymbols("RELI");
    expect(results.length).toBeGreaterThan(0);
    // Exact-prefix matches sort first; alphabetical puts RELIABLE before RELIANCE
    expect(results.map((r) => r.symbol)).toContain("RELIANCE");
    expect(results[0].symbol.startsWith("RELI")).toBe(true);
    expect(searchNseSymbols("RELIANCE")[0].symbol).toBe("RELIANCE");
  });

  it("matches company names case-insensitively", () => {
    const byCompany = searchNseSymbols("zydus wellness");
    expect(byCompany.length).toBeGreaterThan(0);
    expect(byCompany[0].symbol).toBe("ZYDUSWELL");
  });

  it("respects limit and empty queries", () => {
    expect(searchNseSymbols("A", 3).length).toBeLessThanOrEqual(3);
    expect(searchNseSymbols("A", 3).length).toBeGreaterThan(0);
    expect(searchNseSymbols("", 5)).toEqual([]);
    expect(searchNseSymbols("   ", 5)).toEqual([]);
  });
});