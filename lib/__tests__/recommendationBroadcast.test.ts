/**
 * Tests for buildRecommendationBroadcast (lib/services/recommendationBroadcast.ts).
 *
 * The broadcast shows ACTIONABLE picks only — BUY/SELL. HOLDs are never
 * listed as suggestions (they remain in History/Performance). An all-HOLD day
 * sends a short notice instead. Pure function → no mocks needed.
 */

import {
  buildRecommendationBroadcast,
  MAX_BROADCAST_PICKS,
  type BroadcastStock,
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
