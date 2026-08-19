// lib/services/ai/intelligence-prompt.ts — Prompt builder + JSON parser for Intelligence
// Pure functions — no runtime dependencies, no side effects.

import type { IntelligenceInput, IntelligenceAnalysis } from "../intelligenceTypes";

// ─── Prompt Builder ──────────────────────────────────────────────────────────

/**
 * Build a structured prompt for AI investment intelligence analysis.
 * Returns the full prompt string to send to the LLM.
 */
export function buildIntelligencePrompt(input: IntelligenceInput): string {
  const { quote, technicals, valuation, fundamentals, corporate, news, peers } = input;

  const sections: string[] = [];

  // Header
  sections.push(`You are a senior equity research analyst. Analyze the following NSE-listed stock and provide a comprehensive investment intelligence report.`);
  sections.push(`Stock: ${input.symbol}`);
  sections.push("");

  // Market Data
  if (quote) {
    sections.push(`## Market Data`);
    sections.push(`Price: ₹${quote.price} | Change: ${quote.change >= 0 ? "+" : ""}${quote.change} (${quote.percentChange >= 0 ? "+" : ""}${quote.percentChange}%)`);
    sections.push(`P/E: ${quote.pe ?? "N/A"} | P/B: ${quote.pb ?? "N/A"} | Market Cap: ₹${formatLargeNumber(quote.marketCap)}`);
    sections.push(`52W Range: ₹${quote.fiftyTwoWeekLow} – ₹${quote.fiftyTwoWeekHigh}`);
    sections.push(`Volume: ${formatLargeNumber(quote.volume)}`);
    sections.push(`Sector: ${quote.sector} | Industry: ${quote.industry}`);
    sections.push("");
  }

  // Technicals
  if (technicals) {
    sections.push(`## Technical Analysis`);
    sections.push(`Trend: ${technicals.currentTrend} | Strength: ${technicals.trendStrength}`);
    sections.push(`RSI(14): ${technicals.rsi14 ?? "N/A"} | MACD: ${technicals.macdLine ?? "N/A"} | Signal: ${technicals.macdSignal ?? "N/A"}`);
    sections.push(`SMA20: ${technicals.sma20 ? `₹${technicals.sma20.toFixed(2)}` : "N/A"} | SMA50: ${technicals.sma50 ? `₹${technicals.sma50.toFixed(2)}` : "N/A"}`);
    sections.push(`Bollinger: Upper ${technicals.bollingerUpper ?? "N/A"} | Mid ${technicals.bollingerMiddle ?? "N/A"} | Lower ${technicals.bollingerLower ?? "N/A"}`);
    sections.push(`ATR(14): ${technicals.atr14 ?? "N/A"}`);
    sections.push(`Support: ${technicals.support ? `₹${technicals.support.toFixed(2)}` : "N/A"} | Resistance: ${technicals.resistance ? `₹${technicals.resistance.toFixed(2)}` : "N/A"}`);
    sections.push(`Summary: ${technicals.indicatorSummary || "N/A"}`);
    sections.push("");
  }

  // Valuation
  if (valuation) {
    sections.push(`## Valuation`);
    sections.push(`P/E: ${valuation.pe ?? "N/A"} | P/B: ${valuation.pb ?? "N/A"} | EV/EBITDA: ${valuation.evEbitda ?? "N/A"}`);
    sections.push(`PEG: ${valuation.peg ?? "N/A"} | Dividend Yield: ${valuation.dividendYield ?? "N/A"}%`);
    sections.push(`Relative Value: ${valuation.relativeValue}`);
    sections.push(`Assessment: ${valuation.valuationAssessment}`);
    sections.push("");
  }

  // Fundamentals
  if (fundamentals) {
    sections.push(`## Fundamentals`);
    if (fundamentals.quarterlyResults.length > 0) {
      sections.push(`Quarterly Results (recent):`);
      fundamentals.quarterlyResults.slice(0, 4).forEach((q) => {
        sections.push(`  ${q.period}: Revenue ₹${q.revenue ?? "N/A"} | Profit ₹${q.profit ?? "N/A"} | EPS ₹${q.eps ?? "N/A"}`);
      });
    }
    sections.push(`ROCE: ${fundamentals.roce ?? "N/A"}% | ROE: ${fundamentals.roe ?? "N/A"}%`);
    sections.push(`Debt/Equity: ${fundamentals.debtToEquity ?? "N/A"} | Interest Coverage: ${fundamentals.interestCoverage ?? "N/A"}`);
    sections.push(`Trends: Revenue ${fundamentals.revenueTrend} | Profit ${fundamentals.profitTrend} | Working Capital ${fundamentals.workingCapitalTrend}`);
    sections.push("");
  }

  // Corporate
  if (corporate) {
    sections.push(`## Corporate Actions`);
    if (corporate.recentActions.length > 0) {
      corporate.recentActions.slice(0, 5).forEach((a) => {
        sections.push(`  ${a.date}: ${a.type} — ${a.details}`);
      });
    }
    if (corporate.keyAnnouncements.length > 0) {
      sections.push(`Recent Announcements:`);
      corporate.keyAnnouncements.slice(0, 3).forEach((a) => {
        sections.push(`  ${a.date}: ${a.title}`);
      });
    }
    sections.push("");
  }

  // News
  if (news) {
    sections.push(`## News & Catalysts`);
    if (news.recentNews.length > 0) {
      news.recentNews.slice(0, 5).forEach((n) => {
        sections.push(`  ${n.date}: ${n.title} (${n.source})`);
      });
    }
    sections.push("");
  }

  // Peers
  if (peers && peers.peers.length > 0) {
    sections.push(`## Peer Comparison`);
    peers.peers.slice(0, 5).forEach((p) => {
      sections.push(`  ${p.symbol}: ₹${p.price} | P/E ${p.pe ?? "N/A"} | MCap ₹${formatLargeNumber(p.marketCap)}`);
    });
    sections.push("");
  }

  // Output format instruction
  sections.push(`---`);
  sections.push(`Return ONLY a valid JSON object with this exact structure (no markdown fences, no commentary):`);
  sections.push(JSON.stringify({
    verdict: "BUY | HOLD | SELL",
    confidence: "0-100",
    fairValue: { low: "number", mid: "number", high: "number" },
    technicalAnalysis: { trend: "string", support: "number|null", resistance: "number|null", indicators: "string" },
    fundamentalAnalysis: { strengths: ["string[]"], weaknesses: ["string[]"] },
    valuationAssessment: { assessment: "string", relativeValue: "string" },
    newsCatalysts: { positive: ["string[]"], negative: ["string[]"], neutral: ["string[]"] },
    shareholdingTrend: { summary: "string" },
    riskFactors: ["string[]"],
    catalysts: ["string[]"],
    scenarioAnalysis: { bull: "string", base: "string", bear: "string" },
    summary: "1-2 paragraph executive summary",
  }, null, 2));

  return sections.join("\n");
}

// ─── Response Parser ─────────────────────────────────────────────────────────

/**
 * Parse AI response into IntelligenceAnalysis.
 * Extracts JSON from markdown fences or raw text, normalizes, never throws.
 */
export function parseIntelligenceResponse(raw: string): IntelligenceAnalysis | null {
  if (!raw || raw.length < 10) return null;

  try {
    // Try to extract JSON from markdown code fences
    let jsonStr = raw;

    // Try ```json ... ``` fences
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    } else {
      // Try to find raw JSON object
      const braceStart = raw.indexOf("{");
      const braceEnd = raw.lastIndexOf("}");
      if (braceStart >= 0 && braceEnd > braceStart) {
        jsonStr = raw.substring(braceStart, braceEnd + 1);
      }
    }

    const parsed = JSON.parse(jsonStr);

    // Normalize — fill missing fields with defaults
    return normalizeAnalysis(parsed);
  } catch {
    // Try one more time with cleanup
    try {
      // Remove any non-JSON prefix/suffix
      const cleaned = raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "");
      const parsed = JSON.parse(cleaned);
      return normalizeAnalysis(parsed);
    } catch {
      return null;
    }
  }
}

// ─── Normalizer ──────────────────────────────────────────────────────────────

function normalizeAnalysis(raw: Record<string, unknown>): IntelligenceAnalysis {
  const verdict = normalizeVerdict(raw.verdict);
  const confidence = clamp(Number(raw.confidence) || 50, 0, 100);

  const fv = (raw.fairValue ?? {}) as Record<string, unknown>;
  const currentPrice = 0; // will be set by caller if available

  return {
    verdict,
    confidence,
    fairValue: {
      low: Number(fv.low) || 0,
      mid: Number(fv.mid) || 0,
      high: Number(fv.high) || 0,
    },
    technicalAnalysis: {
      trend: String((raw.technicalAnalysis as Record<string, unknown>)?.trend ?? "Unknown"),
      support: toNullableNumber((raw.technicalAnalysis as Record<string, unknown>)?.support),
      resistance: toNullableNumber((raw.technicalAnalysis as Record<string, unknown>)?.resistance),
      indicators: String((raw.technicalAnalysis as Record<string, unknown>)?.indicators ?? ""),
    },
    fundamentalAnalysis: {
      strengths: toStringArray((raw.fundamentalAnalysis as Record<string, unknown>)?.strengths),
      weaknesses: toStringArray((raw.fundamentalAnalysis as Record<string, unknown>)?.weaknesses),
    },
    valuationAssessment: {
      assessment: String((raw.valuationAssessment as Record<string, unknown>)?.assessment ?? ""),
      relativeValue: String((raw.valuationAssessment as Record<string, unknown>)?.relativeValue ?? ""),
    },
    newsCatalysts: {
      positive: toStringArray((raw.newsCatalysts as Record<string, unknown>)?.positive),
      negative: toStringArray((raw.newsCatalysts as Record<string, unknown>)?.negative),
      neutral: toStringArray((raw.newsCatalysts as Record<string, unknown>)?.neutral),
    },
    shareholdingTrend: {
      summary: String((raw.shareholdingTrend as Record<string, unknown>)?.summary ?? ""),
    },
    riskFactors: toStringArray(raw.riskFactors),
    catalysts: toStringArray(raw.catalysts),
    scenarioAnalysis: {
      bull: String((raw.scenarioAnalysis as Record<string, unknown>)?.bull ?? ""),
      base: String((raw.scenarioAnalysis as Record<string, unknown>)?.base ?? ""),
      bear: String((raw.scenarioAnalysis as Record<string, unknown>)?.bear ?? ""),
    },
    summary: String(raw.summary ?? ""),
  };
}

function normalizeVerdict(v: unknown): "BUY" | "HOLD" | "SELL" {
  const s = String(v).toUpperCase().trim();
  if (s === "BUY" || s === "STRONG_BUY") return "BUY";
  if (s === "SELL" || s === "STRONG_SELL") return "SELL";
  return "HOLD";
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function toNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "null" || val === "N/A") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function toStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLargeNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}
