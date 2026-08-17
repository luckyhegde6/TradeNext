// lib/__tests__/closedIpoPrices.test.ts
//
// Tests for the closed IPOs with current prices logic:
// gain/loss % calculation, date filtering, graceful price fallback.

import { parsePriceBandLow } from "@/lib/services/ipoIssueSize";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Simulate the gain % calculation from the closed IPOs route. */
function calcGainPercent(currentPrice: number | null, issuePriceLow: number | null): number | null {
  if (currentPrice === null || issuePriceLow === null || issuePriceLow <= 0) return null;
  const gain = ((currentPrice - issuePriceLow) / issuePriceLow) * 100;
  return Math.round(gain * 100) / 100;
}

/** Simulate the date filtering logic from the closed IPOs route. */
function parseIssueDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  try {
    const [day, mon, year] = dateStr.split("-");
    if (!day || !mon || !year) return null;
    const months: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
    };
    const mi = months[mon.toUpperCase()];
    if (mi === undefined) return null;
    const d = new Date(parseInt(year), mi, parseInt(day));
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function isWithinDays(dateStr: string, days: number): boolean {
  const d = parseIssueDate(dateStr);
  if (!d) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("parsePriceBandLow", () => {
  test("parses standard Rs.XX to Rs.YY format", () => {
    expect(parsePriceBandLow("Rs.92 to Rs.97")).toBe(92);
  });

  test("parses Rs.X,XXX format", () => {
    expect(parsePriceBandLow("Rs.1,200")).toBe(1200);
  });

  test("returns null for empty input", () => {
    expect(parsePriceBandLow(null)).toBeNull();
    expect(parsePriceBandLow("")).toBeNull();
    expect(parsePriceBandLow(undefined)).toBeNull();
  });
});

describe("calcGainPercent", () => {
  test("calculates positive gain correctly", () => {
    // Current ₹542.30 vs issue ₹500 → +8.46%
    const gain = calcGainPercent(542.3, 500);
    expect(gain).toBe(8.46);
  });

  test("calculates negative loss correctly", () => {
    // Current ₹474 vs issue ₹500 → -5.2%
    const gain = calcGainPercent(474, 500);
    expect(gain).toBe(-5.2);
  });

  test("returns null when current price is null", () => {
    expect(calcGainPercent(null, 500)).toBeNull();
  });

  test("returns null when issue price is null", () => {
    expect(calcGainPercent(500, null)).toBeNull();
  });

  test("returns null when issue price is zero", () => {
    expect(calcGainPercent(500, 0)).toBeNull();
  });

  test("handles zero gain (breakeven)", () => {
    expect(calcGainPercent(500, 500)).toBe(0);
  });

  test("rounds to 2 decimal places", () => {
    // 100.12345... → 33.38 (after rounding intermediate)
    const gain = calcGainPercent(133.38, 100);
    expect(gain).toBe(33.38);
  });
});

describe("parseIssueDate", () => {
  test("parses DD-MMM-YYYY format", () => {
    const d = parseIssueDate("14-Aug-2026");
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(14);
    expect(d!.getMonth()).toBe(7); // August = 7
    expect(d!.getFullYear()).toBe(2026);
  });

  test("parses DD-MMM-YYYY with different months", () => {
    const jan = parseIssueDate("05-Jan-2026");
    expect(jan).not.toBeNull();
    expect(jan!.getMonth()).toBe(0);
  });

  test("returns null for empty string", () => {
    expect(parseIssueDate("")).toBeNull();
  });

  test("returns null for invalid format", () => {
    expect(parseIssueDate("not-a-date")).toBeNull();
    expect(parseIssueDate("2026-08-14")).toBeNull(); // ISO format not supported
  });
});

describe("isWithinDays", () => {
  test("returns true for date within the window", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 10);
    const dd = String(recent.getDate()).padStart(2, "0");
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const mmm = months[recent.getMonth()];
    const yyyy = recent.getFullYear();
    const dateStr = `${dd}-${mmm}-${yyyy}`;
    expect(isWithinDays(dateStr, 30)).toBe(true);
  });

  test("returns false for date outside the window", () => {
    const old = new Date();
    old.setDate(old.getDate() - 60);
    const dd = String(old.getDate()).padStart(2, "0");
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const mmm = months[old.getMonth()];
    const yyyy = old.getFullYear();
    const dateStr = `${dd}-${mmm}-${yyyy}`;
    expect(isWithinDays(dateStr, 30)).toBe(false);
  });

  test("returns false for invalid date string", () => {
    expect(isWithinDays("invalid", 30)).toBe(false);
  });

  test("returns true for today", () => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const mmm = months[today.getMonth()];
    const yyyy = today.getFullYear();
    const dateStr = `${dd}-${mmm}-${yyyy}`;
    expect(isWithinDays(dateStr, 30)).toBe(true);
  });
});
