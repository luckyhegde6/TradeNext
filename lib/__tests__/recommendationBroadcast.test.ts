/**
 * Tests for broadcast builders (lib/services/recommendationBroadcast.ts).
 *
 * Daily picks: ACTIONABLE picks only — BUY/SELL. HOLDs are never
 * listed as suggestions (they remain in History/Performance). An all-HOLD day
 * sends a short notice instead.
 *
 * Swing picks: LONG/SHORT with targets and stop-losses. OBSERVE is non-actionable.
 *
 * AI unavailable notice: sent when the pipeline completes but AI failed on
 * every stock.
 *
 * Pure functions → no mocks needed.
 */

import {
  buildRecommendationBroadcast,
  buildSwingBroadcast,
  buildAiUnavailableNotice,
  MAX_BROADCAST_PICKS,
  MAX_SWING_BROADCAST_PICKS,
  type BroadcastStock,
  type SwingBroadcastStock,
} from "@/lib/services/recommendationBroadcast";

const DATE = "13 Aug 2026";

function stock(
  symbol: string,
  recommendation: "BUY" | "HOLD" | "SELL",
  overrides: Partial<BroadcastStock> = {},
): BroadcastStock {
  return {
    symbol,
    price: 100,
    aiRecommendation: {
      recommendation,
      confidence: 75,
      targetPrice: recommendation === "SELL" ? 90 : 110,
      stopLoss: recommendation === "SELL" ? 110 : 90,
    },
    ...overrides,
  };
}

function swingStock(
  symbol: string,
  direction: "LONG" | "SHORT" | "OBSERVE",
  overrides: Partial<SwingBroadcastStock> = {},
): SwingBroadcastStock {
  return {
    symbol,
    price: 500,
    analysis: {
      direction,
      confidence: 80,
      targetPrice: direction === "LONG" ? 550 : direction === "SHORT" ? 450 : undefined,
      stopLoss: direction === "LONG" ? 480 : direction === "SHORT" ? 520 : undefined,
    },
    ...overrides,
  };
}

const BUY = stock("RELIANCE", "BUY");
const SELL = stock("ITC", "SELL");
const HOLD = stock("TCS", "HOLD");

describe("buildRecommendationBroadcast", () => {
  it("lists only BUY and SELL suggestions — HOLDs are never shown as picks", () => {
    const text = buildRecommendationBroadcast([BUY, SELL, HOLD], DATE);

    expect(text).toContain("*RELIANCE* — BUY");
    expect(text).toContain("*ITC* — SELL");
    expect(text).not.toContain("*TCS*");
    expect(text).not.toContain("TCS — HOLD");
  });

  it("includes price, target, stop loss and confidence in the details line", () => {
    const text = buildRecommendationBroadcast([BUY], DATE);

    expect(text).toContain("₹100.00");
    expect(text).toContain("Tgt ₹110.00");
    expect(text).toContain("SL ₹90.00");
    expect(text).toContain("75%");
  });

  it("footers the day summary with BUY/SELL counts and hidden HOLD count", () => {
    const text = buildRecommendationBroadcast([BUY, SELL, HOLD], DATE);

    expect(text).toContain("🟢 1 BUY · 🔴 1 SELL · ⚪ 1 HOLD not shown");
    expect(text).toContain("/recommendations");
  });

  it("shows a short notice (no HOLD rows) when every stock is HOLD", () => {
    const text = buildRecommendationBroadcast([HOLD, HOLD, HOLD], DATE);

    expect(text).toContain("No BUY/SELL picks today — all 3 analyzed stocks rated HOLD");
    expect(text).not.toContain("— HOLD");
    expect(text).not.toContain("HOLD not shown");
  });

  it("uses the exact stock count (singular) on an all-HOLD day with one stock", () => {
    const text = buildRecommendationBroadcast([HOLD], DATE);

    expect(text).toContain("all 1 analyzed stock rated HOLD");
  });

  it("caps suggestions at MAX_BROADCAST_PICKS", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      stock(`STK${i}`, i % 2 === 0 ? "BUY" : "SELL"),
    );
    const text = buildRecommendationBroadcast(many, DATE);

    const pickLines = text.split("\n").filter((l) => l.startsWith("🟢") || l.startsWith("🔴"));
    expect(pickLines.length).toBe(MAX_BROADCAST_PICKS);
    expect(text).not.toContain("*STK19*");
  });

  it("honors a fixed date label (deterministic tests)", () => {
    const text = buildRecommendationBroadcast([BUY], DATE);

    expect(text).toContain(`Daily Recommendations — ${DATE}`);
  });

  it("truncates over-long messages with a truncation marker", () => {
    const longSymbol = "X".repeat(4000);
    const text = buildRecommendationBroadcast([stock(longSymbol, "BUY")], DATE);

    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text.endsWith("*(truncated)*")).toBe(true);
  });
});

// ─── buildSwingBroadcast (v3.16.0) ─────────────────────────────────────────

describe("buildSwingBroadcast", () => {
  const LONG = swingStock("TATASTEEL", "LONG");
  const SHORT = swingStock("ITC", "SHORT");
  const OBSERVE = swingStock("RELIANCE", "OBSERVE");

  it("lists only LONG and SHORT signals — OBSERVE is never shown as a pick", () => {
    const text = buildSwingBroadcast([LONG, SHORT, OBSERVE], DATE);

    expect(text).toContain("*TATASTEEL* — LONG");
    expect(text).toContain("*ITC* — SHORT");
    expect(text).not.toContain("RELIANCE");
    expect(text).not.toContain("OBSERVE");
  });

  it("includes price, target, stop loss and confidence in details", () => {
    const text = buildSwingBroadcast([LONG], DATE);

    expect(text).toContain("₹500.00");
    expect(text).toContain("Tgt ₹550.00");
    expect(text).toContain("SL ₹480.00");
    expect(text).toContain("80%");
  });

  it("footers with LONG/SHORT counts", () => {
    const text = buildSwingBroadcast([LONG, SHORT], DATE);

    expect(text).toContain("📈 1 LONG · 📉 1 SHORT");
    expect(text).toContain("/recommendations");
  });

  it("shows a short notice when no actionable signals exist (all OBSERVE)", () => {
    const text = buildSwingBroadcast([OBSERVE, OBSERVE], DATE);

    expect(text).toContain("No actionable swing signals today — 2 stocks scanned");
    expect(text).toContain("Swing Signals");
    expect(text).not.toContain("OBSERVE");
  });

  it("shows a short notice for empty input", () => {
    const text = buildSwingBroadcast([], DATE);

    expect(text).toContain("No actionable swing signals today — 0 stocks scanned");
  });

  it("handles stocks with null analysis (SwingStock shape)", () => {
    const noAnalysis: SwingBroadcastStock = { symbol: "WIPRO", price: 400, analysis: null };
    const text = buildSwingBroadcast([noAnalysis, LONG], DATE);

    expect(text).not.toContain("WIPRO");
    expect(text).toContain("*TATASTEEL* — LONG");
  });

  it("caps suggestions at MAX_SWING_BROADCAST_PICKS", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      swingStock(`STK${i}`, i % 2 === 0 ? "LONG" : "SHORT"),
    );
    const text = buildSwingBroadcast(many, DATE);

    const pickLines = text.split("\n").filter((l) => l.startsWith("📈") || l.startsWith("📉"));
    expect(pickLines.length).toBe(MAX_SWING_BROADCAST_PICKS);
    expect(text).not.toContain("*STK19*");
  });

  it("honors a fixed date label", () => {
    const text = buildSwingBroadcast([LONG], DATE);

    expect(text).toContain(`Swing Signals — ${DATE}`);
  });

  it("truncates over-long messages", () => {
    const longSymbol = "X".repeat(4000);
    const text = buildSwingBroadcast([swingStock(longSymbol, "LONG")], DATE);

    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text.endsWith("*(truncated)*")).toBe(true);
  });
});

// ─── buildAiUnavailableNotice (v3.16.0) ────────────────────────────────────

describe("buildAiUnavailableNotice", () => {
  it("returns a notice with the date label", () => {
    const text = buildAiUnavailableNotice(DATE);

    expect(text).toContain(`AI Analysis Unavailable — ${DATE}`);
    expect(text).toContain("AI provider could not complete analysis");
    expect(text).toContain("/recommendations");
  });

  it("uses today's date by default", () => {
    const text = buildAiUnavailableNotice();

    expect(text).toContain("AI Analysis Unavailable —");
    expect(text).toContain("next scan at 10:00 AM IST tomorrow");
  });
});
