// lib/services/ai/intelligence-prompt.ts — Prompt builder + JSON parser for Intelligence
// Pure functions — no runtime dependencies, no side effects.
//
// Two generations coexist:
//  - LEGACY: buildIntelligencePrompt / parseIntelligenceResponse — 3-verdict (BUY/HOLD/SELL) report.
//            Kept unchanged (minus a type fix) so existing callers/tests keep working.
//  - NEW:    buildStockAnalysisPrompt / parseStockAnalysisResponse — the full equity-research
//            decision engine (8-level verdict, conviction /10, 12-section institutional memo,
//            evidence discipline, management DNA, valuation zones, bull/base/bear, contrarian
//            test, portfolio action, data gaps, optional document ingestion).

import type {
  IntelligenceInput,
  IntelligenceAnalysis,
  Verdict,
  EvidenceLabel,
  MarketPhase,
  EvidencePoint,
  ManagementDna,
  ValuationZones,
  RiskItem,
  ContrarianView,
  PortfolioAction,
} from "../intelligenceTypes";

/** Optional user-supplied raw-text documents (already normalized by caller). */
export interface StockAnalysisDocuments {
  annualReport?: string;
  concall?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY (v3.18.0) — 3-verdict report
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a structured prompt for AI investment intelligence analysis (legacy 3-verdict).
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

/**
 * Parse AI response into IntelligenceAnalysis (legacy 3-verdict collapse).
 * Extracts JSON from markdown fences or raw text, normalizes, never throws.
 */
export function parseIntelligenceResponse(raw: string): IntelligenceAnalysis | null {
  const jsonStr = extractJson(raw);
  if (!jsonStr) return null;
  try {
    return normalizeAnalysisLegacy(JSON.parse(jsonStr));
  } catch {
    try {
      const cleaned = extractJson(String(raw).replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
      if (!cleaned) return null;
      return normalizeAnalysisLegacy(JSON.parse(cleaned));
    } catch {
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW — Full stock-analysis decision engine
// ═══════════════════════════════════════════════════════════════════════════════

const VERDICTS: Verdict[] = [
  "STRONG_BUY", "BUY", "ACCUMULATE", "HOLD", "REDUCE", "SELL", "STRONG_SELL", "AVOID",
];

/**
 * Build the full institutional-memorandum prompt.
 * `documents` are optional already-normalized raw-text strings (annual report / concall).
 */
export function buildStockAnalysisPrompt(input: IntelligenceInput, documents?: StockAnalysisDocuments): string {
  const { quote, technicals, valuation, fundamentals, shareholding, corporate, news, peers } = input;
  const sections: string[] = [];

  // Role + discipline
  sections.push(
    `You are a senior, skeptical sell-side equity research analyst writing a private institutional investment memo for an NSE-listed stock.`,
    `Be evidence-led: every factual claim must be tagged with an evidence label (VERIFIED_FACT, CALCULATED_METRIC, ANALYST_INTERPRETATION, INVESTMENT_INFERENCE). ` +
      `Never present a projection as a fact. If data is missing, say so in dataGaps rather than inventing it.`,
    `Stock: ${input.symbol}`,
    `Date of analysis: ${new Date().toISOString().slice(0, 10)}`,
    ""
  );

  // Market data
  if (quote) {
    sections.push(`## Market Data`);
    sections.push(`Price: ₹${quote.price} | Change: ${fmtSigned(quote.change)} (${fmtSigned(quote.percentChange)}%)`);
    sections.push(`P/E: ${quote.pe ?? "N/A"} | P/B: ${quote.pb ?? "N/A"} | Market Cap: ₹${formatLargeNumber(quote.marketCap)}`);
    sections.push(`52W Range: ₹${quote.fiftyTwoWeekLow} – ₹${quote.fiftyTwoWeekHigh} | Volume: ${formatLargeNumber(quote.volume)}`);
    sections.push(`Sector: ${quote.sector} | Industry: ${quote.industry} | Face Value: ₹${quote.faceValue ?? "N/A"}`);
    if (quote.dividendYield != null) sections.push(`Dividend Yield: ${quote.dividendYield}%`);
    sections.push("");
  } else {
    sections.push(`## Market Data\nNo market data available.\n`);
  }

  // Technicals
  if (technicals) {
    sections.push(`## Technical Structure (computed from NSE daily bars)`);
    sections.push(`Trend: ${technicals.currentTrend} | Strength: ${technicals.trendStrength} | RSI(14): ${technicals.rsi14 ?? "N/A"}`);
    sections.push(`SMA20: ${num(technicals.sma20)} | SMA50: ${num(technicals.sma50)} | SMA200: ${num(technicals.sma200)}`);
    sections.push(`EMA12: ${num(technicals.ema12)} | EMA26: ${num(technicals.ema26)} | ATR(14): ${technicals.atr14 ?? "N/A"}`);
    sections.push(`Support: ${num(technicals.support)} | Resistance: ${num(technicals.resistance)}`);
    sections.push(`Indicators: ${technicals.indicatorSummary || "N/A"}`);
    sections.push("");
  } else {
    sections.push(`## Technical Structure\nNo technical data available.\n`);
  }

  // Valuation
  if (valuation) {
    sections.push(`## Valuation Snapshot`);
    sections.push(`P/E: ${valuation.pe ?? "N/A"} | P/B: ${valuation.pb ?? "N/A"} | EV/EBITDA: ${valuation.evEbitda ?? "N/A"} | PEG: ${valuation.peg ?? "N/A"}`);
    sections.push(`Sector median P/E: ${valuation.sectorMedianPe ?? "N/A"} | Dividend Yield: ${valuation.dividendYield ?? "N/A"}%`);
    sections.push(`Relative Value: ${valuation.relativeValue} | Assessment: ${valuation.valuationAssessment}`);
    sections.push("");
  } else {
    sections.push(`## Valuation Snapshot\nNo valuation data available.\n`);
  }

  // Fundamentals
  if (fundamentals) {
    sections.push(`## Fundamentals`);
    sections.push(`ROCE: ${fundamentals.roce ?? "N/A"}% | ROE: ${fundamentals.roe ?? "N/A"}% | Debt/Equity: ${fundamentals.debtToEquity ?? "N/A"} | Interest Coverage: ${fundamentals.interestCoverage ?? "N/A"}`);
    sections.push(`Credit Rating: ${fundamentals.creditRating ?? "N/A"} | Net Worth: ${fundamentals.netWorth ? formatLargeNumber(fundamentals.netWorth) : "N/A"} | Total Debt: ${fundamentals.totalDebt ? formatLargeNumber(fundamentals.totalDebt) : "N/A"}`);
    if (fundamentals.quarterlyResults.length > 0) {
      sections.push(`Quarterly Results (recent):`);
      fundamentals.quarterlyResults.slice(0, 6).forEach((q) => {
        const eps = q.eps != null ? ` | EPS ₹${q.eps}` : "";
        sections.push(`  ${q.period}: Revenue ₹${q.revenue ?? "N/A"} | Profit ₹${q.profit ?? "N/A"}${eps}`);
      });
    }
    sections.push(`Trends: Revenue ${fundamentals.revenueTrend} | Profit ${fundamentals.profitTrend} | Working Capital ${fundamentals.workingCapitalTrend}`);
    sections.push("");
  } else {
    sections.push(`## Fundamentals\nNo fundamentals data available.\n`);
  }

  // Shareholding
  if (shareholding) {
    sections.push(`## Shareholding Pattern`);
    sections.push(`Promoters: ${shareholding.promoters != null ? `${shareholding.promoters}%` : "N/A"} | FIIs: ${shareholding.fiis != null ? `${shareholding.fiis}%` : "N/A"} | DIIs: ${shareholding.diis != null ? `${shareholding.diis}%` : "N/A"} | Public: ${shareholding.public != null ? `${shareholding.public}%` : "N/A"}`);
    sections.push(`QoQ change — Promoters: ${shareholding.qoqChanges.promoters ?? "N/A"} | FIIs: ${shareholding.qoqChanges.fiis ?? "N/A"} | DIIs: ${shareholding.qoqChanges.diis ?? "N/A"} | Public: ${shareholding.qoqChanges.public ?? "N/A"}`);
    sections.push(`FII trend: ${shareholding.fiiTrend || "N/A"} | DII trend: ${shareholding.diiTrend || "N/A"} | Promoter pledge: ${shareholding.promoterPledge != null ? `${shareholding.promoterPledge}%` : "N/A"}`);
    sections.push("");
  } else {
    sections.push(`## Shareholding Pattern\nData not available (source does not provide it) — record in dataGaps.\n`);
  }

  // Corporate
  if (corporate) {
    sections.push(`## Corporate Actions & Governance`);
    if (corporate.recentActions.length > 0) {
      corporate.recentActions.slice(0, 5).forEach((a) => sections.push(`  ${a.date}: ${a.type} — ${a.details}`));
    }
    if (corporate.keyAnnouncements.length > 0) {
      sections.push(`Recent Announcements:`);
      corporate.keyAnnouncements.slice(0, 4).forEach((a) => sections.push(`  ${a.date}: ${a.title}`));
    }
    if (corporate.governanceSignals && corporate.governanceSignals.length > 0) {
      sections.push(`Governance signals:`);
      corporate.governanceSignals.slice(0, 5).forEach((s) => sections.push(`  - ${s}`));
    }
    sections.push("");
  } else {
    sections.push(`## Corporate Actions & Governance\nNo data available.\n`);
  }

  // News
  if (news && news.recentNews.length > 0) {
    sections.push(`## News`); 
    news.recentNews.slice(0, 6).forEach((n) => sections.push(`  ${n.date}: ${n.title} (${n.source})`));
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

  // Documents (user-supplied raw text)
  if (documents) {
    sections.push(`## User-Supplied Documents (treat as secondary evidence)`);
    if (documents.annualReport) {
      sections.push(`### Annual Report (paste):\n${documents.annualReport}`);
    }
    if (documents.concall) {
      sections.push(`### Earnings Call Transcript (paste):\n${documents.concall}`);
    }
    sections.push("");
  }

  // Output instruction — full memo
  sections.push(
    `---`,
    `Return ONLY a single valid JSON object (no markdown fences, no commentary) with the exact structure below. ` +
    `Follow the decision engine rules:`,
    `1. verdict is ALWAYS one of the 8 levels; derive conviction (/10) to match, and confidence (/100) as a separate 0-100 expression of model certainty.`,
    `2. Every conclusion in fundamentalScore.evidence must carry an evidence label.`,
    `3. If a data source is missing (e.g. shareholding, news, peers, sma200, P/B), NEVER invent values — add the missing item to dataGaps and mark the field with a clear "unknown/not available".`,
    `4. valuationZones are absolute INR price ranges: attractive (deep value), fair, and over (froth).`,
    `5. contrarian: state the prevailing market belief, argue what-if-it-is-wrong, and list supporting + contradicting evidence.`,
    `6. portfolioAction must be practical (hold/add/trim/exit; initiate now/gradually/wait/avoid; CORE/SATELLITE/SPECULATIVE/WATCHLIST).`,
    `7. invalidation gives the specific conditions that would invalidate the thesis and the INR zones for entry/fair/over.`,
    JSON.stringify({
      verdict: VERDICTS.join(" | "),
      conviction: "0-10",
      confidence: "0-100",
      fairValue: { low: "number", mid: "number", high: "number" },
      valuationZones: { attractiveLow: "number", attractiveHigh: "number", fairLow: "number", fairHigh: "number", overLow: "number", overHigh: "number", assumptions: ["string[]"] },
      executiveSummary: { oneSentenceThesis: "string", threeBiggestReasons: ["string"] },
      fundamentalScore: { score: "0-10", revenue: "string", profit: "string", margins: "string", cashFlow: "string", balanceSheet: "string", roe: "string", accountingQuality: "string", verdict: "string", evidence: [{ label: "VERIFIED_FACT|CALCULATED_METRIC|ANALYST_INTERPRETATION|INVESTMENT_INFERENCE", text: "string", period: "string?", source: "string?" }] },
      managementDna: { score: "0-10", positives: ["string"], concerns: ["string"], guidanceCredibility: "conservative|reliable|promotional|unclear|unknown", capitalAllocation: "string", promoterBehavior: "string (incl pledge status)", verdict: "string" },
      valuationReality: { current: "string", historical: "string", peer: "string", growthAdjusted: "string", conclusion: "CHEAP|FAIRLY VALUED|EXPENSIVE|EXTREMELY EXPENSIVE" },
      technicalStructure: { trend: "string", priceVs50: "string", priceVs200: "string", rsi: "string", volume: "string", support: "number|null", resistance: "number|null", marketPhase: "ACCUMULATION|MARKUP|DISTRIBUTION|MARKDOWN|BASE|UNKNOWN", verdict: "string" },
      shareholdingAnalysis: { promoter: "string", promoterPledge: "string", fii: "string", dii: "string", interpretation: "string" },
      riskFactors: [{ risk: "string", category: "COMPANY|SECTOR|MACRO", probability: "string", impact: "string", earlyWarning: "string", pricedIn: "boolean" }],
      catalysts: ["string"],
      scenarioAnalysis: { bull: "string", base: "string", bear: "string" },
      contrarian: { marketBelief: "string", whatIfWrong: "string", supporting: ["string"], contradicting: ["string"] },
      whatWouldChangeMyMind: ["string"],
      portfolioAction: { existingHolder: "string", newInvestor: "string", positionSizing: "CORE|SATELLITE|SPECULATIVE|WATCHLIST|NONE" },
      invalidation: { thesisInvalidation: "string", entryZone: "string", fairZone: "string", overZone: "string", holdingHorizon: "string" },
      dataGaps: ["string"],
      legacy: { /* these are kept populated for backward compatibility */ },
    }, null, 2)
  );

  return sections.join("\n");
}

/**
 * Parse the full stock-analysis JSON response into IntelligenceAnalysis (8-level verdict).
 * Never throws. Falls back to defaults for missing fields; legacy 3-verdict reports are accepted
 * and mapped onto the 8-level enum (BUY→BUY, HOLD→HOLD, SELL→SELL) with the other new fields defaulted.
 */
export function parseStockAnalysisResponse(raw: string): IntelligenceAnalysis | null {
  const jsonStr = extractJson(raw);
  if (!jsonStr) return null;
  try {
    return normalizeAnalysis(JSON.parse(jsonStr));
  } catch {
    try {
      const cleaned = extractJson(String(raw).replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
      if (!cleaned) return null;
      return normalizeAnalysis(JSON.parse(cleaned));
    } catch {
      return null;
    }
  }
}

// ─── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(raw: string | null | undefined): string | null {
  if (!raw || raw.length < 10) return null;
  const r = String(raw);
  const fenceMatch = r.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceStart = r.indexOf("{");
  const braceEnd = r.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) return r.substring(braceStart, braceEnd + 1);
  return null;
}

// ─── Normalizers ───────────────────────────────────────────────────────────────

/** Legacy 3-verdict normalizer (backward compatible output; risk strings → RiskItem objects). */
function normalizeAnalysisLegacy(raw: Record<string, unknown>): IntelligenceAnalysis {
  return {
    verdict: normalizeVerdictLegacy(raw.verdict),
    confidence: clamp(Number(raw.confidence) || 50, 0, 100),
    fairValue: toFairValue(raw.fairValue),
    // legacy-only fields; new optional fields intentionally omitted
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
    riskFactors: toRiskItems(raw.riskFactors),
    catalysts: toStringArray(raw.catalysts),
    scenarioAnalysis: {
      bull: String((raw.scenarioAnalysis as Record<string, unknown>)?.bull ?? ""),
      base: String((raw.scenarioAnalysis as Record<string, unknown>)?.base ?? ""),
      bear: String((raw.scenarioAnalysis as Record<string, unknown>)?.bear ?? ""),
    },
    summary: String(raw.summary ?? ""),
  };
}

/** Full 8-verdict normalizer for the new decision engine. */
function normalizeAnalysis(raw: Record<string, unknown>): IntelligenceAnalysis {
  const verdict = normalizeVerdict(raw.verdict);
  const conviction = clamp(Number(raw.conviction) || verdictToConviction(verdict), 0, 10);
  const confidence = clamp(Number(raw.confidence) || conviction * 10, 0, 100);

  const ta = (raw.technicalStructure ?? {}) as Record<string, unknown>;
  const fa = (raw.fundamentalScore ?? {}) as Record<string, unknown>;

  return {
    // Decision
    verdict,
    conviction,
    confidence,
    fairValue: toFairValue(raw.fairValue),
    valuationZones: toValuationZones(raw.valuationZones),

    // Executive summary
    executiveSummary: {
      oneSentenceThesis: String((raw.executiveSummary as Record<string, unknown>)?.oneSentenceThesis ?? ""),
      threeBiggestReasons: toStringArray((raw.executiveSummary as Record<string, unknown>)?.threeBiggestReasons),
    },

    // Pillars
    fundamentalScore: {
      score: clamp(Number(fa.score) || 0, 0, 10),
      revenue: String(fa.revenue ?? ""),
      profit: String(fa.profit ?? ""),
      margins: String(fa.margins ?? ""),
      cashFlow: String(fa.cashFlow ?? ""),
      balanceSheet: String(fa.balanceSheet ?? ""),
      roe: String(fa.roe ?? ""),
      accountingQuality: String(fa.accountingQuality ?? ""),
      verdict: String(fa.verdict ?? ""),
      evidence: toEvidencePoints(fa.evidence),
    },
    managementDna: toManagementDna(raw.managementDna),
    valuationReality: {
      current: String((raw.valuationReality as Record<string, unknown>)?.current ?? ""),
      historical: String((raw.valuationReality as Record<string, unknown>)?.historical ?? ""),
      peer: String((raw.valuationReality as Record<string, unknown>)?.peer ?? ""),
      growthAdjusted: String((raw.valuationReality as Record<string, unknown>)?.growthAdjusted ?? ""),
      conclusion: String((raw.valuationReality as Record<string, unknown>)?.conclusion ?? "UNKNOWN"),
    },
    technicalStructure: {
      trend: String(ta.trend ?? ""),
      priceVs50: String(ta.priceVs50 ?? ""),
      priceVs200: String(ta.priceVs200 ?? ""),
      rsi: String(ta.rsi ?? ""),
      volume: String(ta.volume ?? ""),
      support: toNullableNumber(ta.support),
      resistance: toNullableNumber(ta.resistance),
      marketPhase: normalizeMarketPhase(ta.marketPhase),
      verdict: String(ta.verdict ?? ""),
    },
    shareholdingAnalysis: {
      promoter: String((raw.shareholdingAnalysis as Record<string, unknown>)?.promoter ?? ""),
      promoterPledge: String((raw.shareholdingAnalysis as Record<string, unknown>)?.promoterPledge ?? ""),
      fii: String((raw.shareholdingAnalysis as Record<string, unknown>)?.fii ?? ""),
      dii: String((raw.shareholdingAnalysis as Record<string, unknown>)?.dii ?? ""),
      interpretation: String((raw.shareholdingAnalysis as Record<string, unknown>)?.interpretation ?? ""),
    },

    // Risks + catalysts
    riskFactors: toRiskItems(raw.riskFactors),
    catalysts: toStringArray(raw.catalysts),

    // Scenarios + contrarian
    scenarioAnalysis: {
      bull: String((raw.scenarioAnalysis as Record<string, unknown>)?.bull ?? ""),
      base: String((raw.scenarioAnalysis as Record<string, unknown>)?.base ?? ""),
      bear: String((raw.scenarioAnalysis as Record<string, unknown>)?.bear ?? ""),
    },
    contrarian: {
      marketBelief: String((raw.contrarian as Record<string, unknown>)?.marketBelief ?? ""),
      whatIfWrong: String((raw.contrarian as Record<string, unknown>)?.whatIfWrong ?? ""),
      supporting: toStringArray((raw.contrarian as Record<string, unknown>)?.supporting),
      contradicting: toStringArray((raw.contrarian as Record<string, unknown>)?.contradicting),
    },
    whatWouldChangeMyMind: toStringArray(raw.whatWouldChangeMyMind),

    // Portfolio action + invalidation
    portfolioAction: {
      existingHolder: String((raw.portfolioAction as Record<string, unknown>)?.existingHolder ?? ""),
      newInvestor: String((raw.portfolioAction as Record<string, unknown>)?.newInvestor ?? ""),
      positionSizing: normalizePositionSizing((raw.portfolioAction as Record<string, unknown>)?.positionSizing),
    },
    invalidation: {
      thesisInvalidation: String((raw.invalidation as Record<string, unknown>)?.thesisInvalidation ?? ""),
      entryZone: String((raw.invalidation as Record<string, unknown>)?.entryZone ?? ""),
      fairZone: String((raw.invalidation as Record<string, unknown>)?.fairZone ?? ""),
      overZone: String((raw.invalidation as Record<string, unknown>)?.overZone ?? ""),
      holdingHorizon: String((raw.invalidation as Record<string, unknown>)?.holdingHorizon ?? ""),
    },

    // Honesty
    dataGaps: toStringArray(raw.dataGaps),

    // Legacy mirrored fields (populated for backward compatibility)
    technicalAnalysis: {
      trend: String(ta.trend ?? (raw.technicalAnalysis as Record<string, unknown>)?.trend ?? ""),
      support: ta.support != null ? toNullableNumber(ta.support) : toNullableNumber((raw.technicalAnalysis as Record<string, unknown>)?.support),
      resistance: ta.resistance != null ? toNullableNumber(ta.resistance) : toNullableNumber((raw.technicalAnalysis as Record<string, unknown>)?.resistance),
      indicators: String(ta.verdict ?? (raw.technicalAnalysis as Record<string, unknown>)?.indicators ?? ""),
    },
    fundamentalAnalysis: {
      strengths: toStringArray(fa.verdict).length
        ? toStringArray((raw.fundamentalAnalysis as Record<string, unknown>)?.strengths)
        : toStringArray((raw.fundamentalAnalysis as Record<string, unknown>)?.strengths),
      weaknesses: toStringArray((raw.fundamentalAnalysis as Record<string, unknown>)?.weaknesses),
    },
    valuationAssessment: {
      assessment: String(raw.valuationReality ? (raw.valuationReality as Record<string, unknown>)?.conclusion ?? "" : (raw.valuationAssessment as Record<string, unknown>)?.assessment ?? ""),
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
    summary: String(raw.summary ?? (raw.executiveSummary as Record<string, unknown>)?.oneSentenceThesis ?? ""),
  };
}

// ─── Value coercers ────────────────────────────────────────────────────────────

const VERDICT_SET: Verdict[] = ["STRONG_BUY", "BUY", "ACCUMULATE", "HOLD", "REDUCE", "SELL", "STRONG_SELL", "AVOID"];

function normalizeVerdict(v: unknown, legacy = false): Verdict {
  if (legacy) return normalizeVerdictLegacy(v) as Verdict;
  const s = String(v).toUpperCase().trim();
  const asVerdict = s as Verdict;
  if (VERDICT_SET.includes(asVerdict)) return asVerdict;
  // Map legacy / natural-language aliases onto the 8-level scale
  if (s === "STRONG BUY" || s === "STRONG-BUY" || s === "CONVICTION BUY" || s === "STRONG ACCUMULATE") return "STRONG_BUY";
  if (s === "STRONG SELL" || s === "STRONG-SELL") return "STRONG_SELL";
  if (s === "ADD" || s === "OVERWEIGHT") return "BUY";
  if (s === "UNDERWEIGHT" || s === "TRIM") return "SELL";
  if (s === "NEUTRAL" || s === "EQUAL WEIGHT") return "HOLD";
  return "HOLD";
}

function normalizeVerdictLegacy(v: unknown): "BUY" | "HOLD" | "SELL" {
  const s = String(v).toUpperCase().trim();
  if (s === "BUY" || s === "STRONG_BUY" || s === "STRONG BUY" || s === "ACCUMULATE" || s === "CONVICTION BUY") return "BUY";
  if (s === "SELL" || s === "STRONG_SELL" || s === "STRONG SELL" || s === "REDUCE" || s === "AVOID") return "SELL";
  return "HOLD";
}

function verdictToConviction(v: Verdict): number {
  switch (v) {
    case "STRONG_BUY": return 9;
    case "BUY": return 7;
    case "ACCUMULATE": return 6;
    case "HOLD": return 5;
    case "REDUCE": return 4;
    case "SELL": return 3;
    case "STRONG_SELL": return 2;
    case "AVOID": return 1;
    default: return 5;
  }
}

const MARKET_PHASES: MarketPhase[] = ["ACCUMULATION", "MARKUP", "DISTRIBUTION", "MARKDOWN", "BASE", "UNKNOWN"];
function normalizeMarketPhase(v: unknown): MarketPhase {
  const s = String(v).toUpperCase().trim();
  return (MARKET_PHASES as string[]).includes(s) ? (s as MarketPhase) : "UNKNOWN";
}

const POSITION_SIZING = ["CORE", "SATELLITE", "SPECULATIVE", "WATCHLIST", "NONE"] as const;
function normalizePositionSizing(v: unknown): PortfolioAction["positionSizing"] {
  const s = String(v).toUpperCase().trim();
  return (POSITION_SIZING as readonly string[]).includes(s) ? (s as PortfolioAction["positionSizing"]) : "NONE";
}

function toFairValue(v: unknown): IntelligenceAnalysis["fairValue"] {
  const o = (v ?? {}) as Record<string, unknown>;
  return { low: Number(o.low) || 0, mid: Number(o.mid) || 0, high: Number(o.high) || 0 };
}

function toValuationZones(v: unknown): ValuationZones | undefined {
  const o = (v ?? {}) as Record<string, unknown>;
  const hasAny = Object.values(o).some((x) => x != null && x !== "");
  if (!hasAny) return undefined;
  return {
    attractiveLow: toNullableNumber(o.attractiveLow) ?? undefined,
    attractiveHigh: toNullableNumber(o.attractiveHigh) ?? undefined,
    fairLow: toNullableNumber(o.fairLow) ?? undefined,
    fairHigh: toNullableNumber(o.fairHigh) ?? undefined,
    overLow: toNullableNumber(o.overLow) ?? undefined,
    overHigh: toNullableNumber(o.overHigh) ?? undefined,
    assumptions: toStringArray(o.assumptions),
  };
}

function toRiskItems(v: unknown): RiskItem[] {
  if (v == null) return [];
  if (!Array.isArray(v)) return [];
  const items: RiskItem[] = [];
  for (const entry of v) {
    if (typeof entry === "string") {
      // Legacy string form → object with defaults
      items.push({ risk: entry, category: "COMPANY", probability: "", impact: "", earlyWarning: "", pricedIn: false });
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      items.push({
        risk: String(o.risk ?? ""),
        category: normalizeRiskCategory(o.category),
        probability: String(o.probability ?? ""),
        impact: String(o.impact ?? ""),
        earlyWarning: String(o.earlyWarning ?? ""),
        pricedIn: Boolean(o.pricedIn),
      });
    }
  }
  return items;
}

function normalizeRiskCategory(v: unknown): RiskItem["category"] {
  const s = String(v).toUpperCase().trim();
  if (s === "COMPANY" || s === "SECTOR" || s === "MACRO") return s;
  return "COMPANY";
}

const EVIDENCE_LABELS: EvidenceLabel[] = ["VERIFIED_FACT", "CALCULATED_METRIC", "ANALYST_INTERPRETATION", "INVESTMENT_INFERENCE"];

function toEvidencePoints(v: unknown): EvidencePoint[] {
  if (!Array.isArray(v)) return [];
  const points: EvidencePoint[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const label = String(o.label ?? "").toUpperCase().trim() as EvidenceLabel;
    points.push({
      label: (EVIDENCE_LABELS as string[]).includes(label) ? label : "ANALYST_INTERPRETATION",
      text: String(o.text ?? ""),
      period: o.period != null ? String(o.period) : undefined,
      source: o.source != null ? String(o.source) : undefined,
    });
  }
  return points;
}

function toManagementDna(v: unknown): ManagementDna {
  const o = (v ?? {}) as Record<string, unknown>;
  const credibility = String(o.guidanceCredibility ?? "unknown").toLowerCase();
  return {
    score: clamp(Number(o.score) || 0, 0, 10),
    positives: toStringArray(o.positives),
    concerns: toStringArray(o.concerns),
    guidanceCredibility:
      credibility === "conservative" || credibility === "reliable" || credibility === "promotional" || credibility === "unclear"
        ? (credibility as ManagementDna["guidanceCredibility"])
        : "unknown",
    capitalAllocation: String(o.capitalAllocation ?? ""),
    promoterBehavior: String(o.promoterBehavior ?? ""),
    verdict: String(o.verdict ?? ""),
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function toNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "null" || val === "N/A" || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function toStringArray(val: unknown): string[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
}

function num(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "N/A";
  return `₹${v.toFixed(2)}`;
}

function fmtSigned(n: number | null | undefined): string {
  if (n == null) return "N/A";
  return `${n >= 0 ? "+" : ""}${n}`;
}

function formatLargeNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}
