/**
 * Telegram broadcast message builders for the daily recommendations run
 * and the swing trading signals pipeline.
 *
 * Daily picks: actionable picks ONLY (BUY/SELL). HOLDs are never listed as
 * suggestions — an all-HOLD day sends a short notice instead.
 *
 * Swing picks: LONG/SHORT with targets and stop-losses.
 *
 * AI unavailable notice: sent when the pipeline completes but AI failed on
 * every stock — subscribers still get a daily heartbeat so they know the
 * system is operating.
 *
 * Pure functions (no imports, no IO) so they are trivially testable.
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

/** Minimal stock shape for the swing broadcast (subset of SwingStock). */
export interface SwingBroadcastStock {
  symbol: string;
  price: number;
  analysis?: {
    direction?: "LONG" | "SHORT" | "OBSERVE";
    action?: "LONG" | "SHORT" | "OBSERVE";
    confidence: number;
    targetPrice?: number;
    stopLoss?: number;
    reasoning?: string;
    logic?: string;
  } | null;
}

export const MAX_BROADCAST_PICKS = 8;
export const MAX_SWING_BROADCAST_PICKS = 10;

const REC_ICONS: Record<string, string> = { BUY: "🟢", SELL: "🔴", HOLD: "⚪" };
const SWING_ICONS: Record<string, string> = { LONG: "📈", SHORT: "📉", OBSERVE: "👀" };

function defaultDateLabel(): string {
  return new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Build a notice for subscribers when AI analysis was entirely unavailable.
 * Sent instead of the normal broadcast so subscribers know the system is
 * working but the AI provider was down.
 */
export function buildAiUnavailableNotice(
  dateLabel: string = defaultDateLabel(),
): string {
  return (
    `⚠️ *AI Analysis Unavailable — ${dateLabel}*\n\n` +
    `The AI provider could not complete analysis today. No daily picks generated.\n\n` +
    `The system is operating normally — next scan at 10:00 AM IST tomorrow.\n` +
    `View TradeNext → /recommendations`
  );
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

/**
 * Build the Telegram broadcast message for swing trading signals.
 * @param stocks Swing stocks with optional AI analysis.
 * @param dateLabel Optional fixed date label (tests pass one for determinism).
 */
export function buildSwingBroadcast(
  stocks: SwingBroadcastStock[],
  dateLabel: string = defaultDateLabel(),
): string {
  // Only broadcast stocks with AI analysis (LONG/SHORT). OBSERVE is non-actionable.
  // analysis can be null (SwingStock shape) — filter those out too.
  // SwingAnalysis uses `action`; SwingBroadcastStock uses `direction` — handle both.
  const getDir = (a: NonNullable<SwingBroadcastStock["analysis"]>) => (a.direction ?? a.action) as string | undefined;
  const actionable = stocks.filter(
    (s) => {
      const dir = s.analysis != null ? getDir(s.analysis) : undefined;
      return dir === "LONG" || dir === "SHORT";
    },
  );

  if (actionable.length === 0) {
    return (
      `🌊 *Swing Signals — ${dateLabel}*\n\n` +
      `No actionable swing signals today — ${stocks.length} stock${stocks.length === 1 ? "" : "s"} scanned.\n\n` +
      `View the full analysis on TradeNext → /recommendations`
    );
  }

  const topStocks = actionable.slice(0, MAX_SWING_BROADCAST_PICKS);
  const lines = topStocks.map((s) => {
    const a = s.analysis!;
    const dir = getDir(a) ?? "OBSERVE";
    const icon = SWING_ICONS[dir] || "👀";
    const conf = `${a.confidence}%`;
    const price = s.price ? `₹${s.price.toFixed(2)}` : "";
    const target = a.targetPrice ? `Tgt ₹${a.targetPrice.toFixed(2)}` : "";
    const sl = a.stopLoss ? `SL ₹${a.stopLoss.toFixed(2)}` : "";
    const details = [price, target, sl, conf].filter(Boolean).join(" | ");
    return `${icon} *${s.symbol}* — ${dir}\n  ${details}`;
  });

  const longCount = actionable.filter((s) => getDir(s.analysis!) === "LONG").length;
  const shortCount = actionable.length - longCount;

  let text = `🌊 *Swing Signals — ${dateLabel}*\n\n${lines.join("\n\n")}`;
  text +=
    `\n\n_📈 ${longCount} LONG · 📉 ${shortCount} SHORT` +
    ` — view all on TradeNext → /recommendations_`;

  if (text.length > 4000) {
    text = text.slice(0, 4000 - "\n\n*(truncated)*".length) + "\n\n*(truncated)*";
  }
  return text;
}
