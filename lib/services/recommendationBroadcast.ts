/**
 * Telegram broadcast message builder for the daily recommendations run.
 *
 * Suggestions = actionable picks ONLY (BUY/SELL). HOLDs are never listed as
 * suggestions — they belong in History/Performance (they are still stored and
 * tracked). An all-HOLD day sends a short notice instead of HOLD rows so
 * subscribers still get their daily heartbeat without being shown
 * non-actionable picks.
 *
 * Pure function (no imports, no IO) so it is trivially testable.
 */

export interface BroadcastStock {
  symbol: string;
  price: number;
  aiRecommendation: {
    recommendation: "BUY" | "HOLD" | "SELL";
    confidence: number;
    targetPrice: number;
    stopLoss: number;
  };
}

export const MAX_BROADCAST_PICKS = 8;

const REC_ICONS: Record<string, string> = { BUY: "🟢", SELL: "🔴", HOLD: "⚪" };

function defaultDateLabel(): string {
  return new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Build the Telegram broadcast message for a daily recommendations run.
 * @param stocks All analyzed stocks from the run (BUY/SELL/HOLD).
 * @param dateLabel Optional fixed date label (tests pass one for determinism).
 */
export function buildRecommendationBroadcast(
  stocks: BroadcastStock[],
  dateLabel: string = defaultDateLabel(),
): string {
  const nonHold = stocks.filter((r) => r.aiRecommendation.recommendation !== "HOLD");

  // All-HOLD day: notice only — no HOLD suggestions.
  if (nonHold.length === 0) {
    const count = stocks.length;
    return (
      `📈 *Daily Recommendations — ${dateLabel}*\n\n` +
      `No BUY/SELL picks today — all ${count} analyzed stock${count === 1 ? "" : "s"} rated HOLD.\n\n` +
      `View the full analysis on TradeNext → /recommendations`
    );
  }

  const topStocks = nonHold.slice(0, MAX_BROADCAST_PICKS);
  const lines = topStocks.map((r) => {
    const icon = REC_ICONS[r.aiRecommendation.recommendation] || "⚪";
    const conf = `${r.aiRecommendation.confidence}%`;
    const price = r.price ? `₹${r.price.toFixed(2)}` : "";
    const target = r.aiRecommendation.targetPrice
      ? `Tgt ₹${r.aiRecommendation.targetPrice.toFixed(2)}`
      : "";
    const sl = r.aiRecommendation.stopLoss
      ? `SL ₹${r.aiRecommendation.stopLoss.toFixed(2)}`
      : "";
    const details = [price, target, sl, conf].filter(Boolean).join(" | ");
    return `${icon} *${r.symbol}* — ${r.aiRecommendation.recommendation}\n  ${details}`;
  });

  const buyCount = nonHold.filter((r) => r.aiRecommendation.recommendation === "BUY").length;
  const sellCount = nonHold.length - buyCount;
  const holdCount = stocks.length - nonHold.length;

  let text = `📈 *Daily Recommendations — ${dateLabel}*\n\n${lines.join("\n\n")}`;
  text +=
    `\n\n_🟢 ${buyCount} BUY · 🔴 ${sellCount} SELL` +
    (holdCount > 0 ? ` · ⚪ ${holdCount} HOLD not shown` : "") +
    ` — view all on TradeNext → /recommendations_`;

  if (text.length > 4000) {
    text = text.slice(0, 4000 - "\n\n*(truncated)*".length) + "\n\n*(truncated)*";
  }
  return text;
}
