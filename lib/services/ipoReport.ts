// lib/services/ipoReport.ts
//
// Pure helpers for the AI IPO report v2 (JSON architecture).
//
// Design: the LLM returns ONE structured JSON object conforming to `IpoReport`
// (the 18-section brokerage-report spec below). A single client-side template
// (`app/components/recommendations/IpoReportView.tsx`) renders it; the model
// never emits HTML/markdown for layout. Robust fence extraction + schema
// validation guarantee a consistent, portable report (PDF/dashboard/mobile).
//
// No Prisma/IO here — importable from client for shared types where needed.

/* ─── Report schema (18-section spec) ─── */

export interface IpoReportScore {
  category: string;
  score: number; // out of 10
}

export interface IpoFinancialRow {
  metric: string;
  fy1: string; // latest
  fy2: string;
  fy3: string;
}

export interface IpoGmp {
  value: string; // e.g. "₹90"
  estimatedListingPrice: string;
  expectedGainPct: number; // e.g. 12.5
  trend: "Increasing" | "Stable" | "Declining";
  healthNote: string;
}

export interface IpoNewsItem {
  date: string;
  headline: string;
  tag?: "Positive" | "Negative" | "Neutral";
}

export interface IpoPeer {
  name: string;
  revenue: string;
  patMargin: string;
  roe: string;
  pe: string;
  marketCap: string;
}

export interface IpoRisk {
  risk: string;
  level: "Low" | "Medium" | "High";
  note: string;
}

export interface IpoStrategy {
  scenario: string; // e.g. "Strong Listing (>30%)"
  probability: number; // 0-100
  play: string; // what the investor should do
}

export interface IpoTarget {
  horizon: string; // "1 Year" | "3 Years" | "5 Years"
  bull: string;
  base: string;
  bear: string;
}

export interface IpoReport {
  company: {
    name: string;
    symbol: string;
    sector: string;
    businessModel: string;
    promoter: string;
    institutionalBacking: string;
  };
  summaryScores: {
    label: string; // e.g. "Business Quality"
    value: number; // 0-100 (or /10)
    tone?: "green" | "amber" | "red";
  }[];
  verdict: {
    label: "STRONG BUY" | "BUY" | "HOLD" | "PARTIAL PROFIT BOOKING" | "EXIT ON LISTING";
    headline: string;
    reasons: string[]; // top 3
    confidencePct: number;
  };
  quickSnapshots: { label: string; value: string }[];
  businessOverview: string;
  financials: {
    rating: "Excellent" | "Good" | "Average" | "Poor";
    summary: string;
    rows: IpoFinancialRow[];
  };
  ipoDetails: { label: string; value: string }[];
  gmp: IpoGmp | null;
  news: IpoNewsItem[];
  sentiment: {
    summary: string;
    bullish: string[];
    bearish: string[];
    hypeDriven: boolean;
  };
  peers: {
    valuation: "Undervalued" | "Fairly Valued" | "Overvalued";
    summary: string;
    rows: IpoPeer[];
  };
  futureGrowth: {
    summary: string;
    roadmap: string[]; // expansion/capex/products/policy
    oneYear: string;
    threeYear: string;
    fiveYear: string;
  };
  risks: IpoRisk[];
  listingStrategy: {
    summary: string;
    scenarios: IpoStrategy[];
  };
  targets: IpoTarget[];
  finalScore: {
    outOf10: Record<string, number>;
    total: number; // out of 100
  };
  finalRecommendation: string; // plain-English why
  disclaimer: string;
}

/* ─── Prompt builder ─── */

export interface IpoPromptInput {
  companyName: string;
  symbol: string;
  /** e.g. "Rs.92 to Rs.97" or "Not yet announced". */
  priceRange: string;
  minimumInvestment: string; // human string e.g. "₹92 (1 lot × ₹92)"
  issueStartDate?: string;
  issueEndDate?: string;
}

/**
 * Build the v2 prompt. Instructs the model to return ONLY a JSON object
 * matching the 18-section `IpoReport` schema (embedded as a compact shape
 * reference). No markdown prose — the client template renders it.
 */
export function buildIpoReportPrompt(input: IpoPromptInput): string {
  const listingDate =
    input.issueEndDate || input.issueStartDate || "Not yet announced (typically T+3 after close)";
  const name = input.companyName || input.symbol;

  return `You are an experienced equity research analyst specializing in Indian IPOs. Analyze the IPO below and return ONE valid JSON object — nothing else. Do not wrap in markdown bullets or prose; output only the JSON.

Analyze: ${name} (${input.symbol})
Price Band: ${input.priceRange}
LOT: 1 share · Minimum Investment (for ROI): ${input.minimumInvestment}
Listing Date: ${listingDate}

Use the latest verifiable data. Base the verdict on business quality, valuation, financials and long-term growth — never GMP alone. If a field is unknown use "N/A".

Return JSON with EXACTLY these keys (each is a section of a brokerage report):

{
  "company": { "name", "symbol", "sector", "businessModel", "promoter", "institutionalBacking" },
  "summaryScores": [ { "label", "value" (0-100), "tone" ("green"|"amber"|"red") } ],
  "verdict": { "label" (one of: "STRONG BUY"|"BUY"|"HOLD"|"PARTIAL PROFIT BOOKING"|"EXIT ON LISTING"), "headline", "reasons" [3 strings], "confidencePct" (0-100) },
  "quickSnapshots": [ { "label", "value" } ],
  "businessOverview": "paragraph",
  "financials": { "rating" ("Excellent"|"Good"|"Average"|"Poor"), "summary", "rows": [ { "metric", "fy1", "fy2", "fy3" } ] },
  "ipoDetails": [ { "label", "value" } ],
  "gmp": { "value", "estimatedListingPrice", "expectedGainPct", "trend" ("Increasing"|"Stable"|"Declining"), "healthNote" } or null,
  "news": [ { "date", "headline", "tag" ("Positive"|"Negative"|"Neutral") } ],
  "sentiment": { "summary", "bullish": [], "bearish": [], "hypeDriven": bool },
  "peers": { "valuation" ("Undervalued"|"Fairly Valued"|"Overvalued"), "summary", "rows": [ { "name", "revenue", "patMargin", "roe", "pe", "marketCap" } ] },
  "futureGrowth": { "summary", "roadmap": [], "oneYear", "threeYear", "fiveYear" },
  "risks": [ { "risk", "level" ("Low"|"Medium"|"High"), "note" } ],
  "listingStrategy": { "summary", "scenarios": [ { "scenario", "probability" (0-100), "play" } ] },
  "targets": [ { "horizon" ("1 Year"|"3 Years"|"5 Years"), "bull", "base", "bear" } ],
  "finalScore": { "outOf10": { "Business Quality":0, "Financial Strength":0, "Management":0, "Valuation":0, "Industry Outlook":0, "Growth Potential":0, "Risk":0, "Competitive Advantage":0, "Institutional Interest":0 }, "total" (sum out of 100) },
  "finalRecommendation": "plain-English why",
  "disclaimer": "short risk disclaimer"
}

Rules:
• Return ONLY the JSON object, no fences unless the environment requires them (a \`\`\`json ... \`\`\` fence is acceptable).
• Fill every key. Empty arrays are valid.
• Scores out of 10 (finalScore.outOf10) and total 0-100 (finalScore.total).
• confidencePct reflects how sure you are, and why not 100%.
• End with a finalRecommendation summarizing the recommended action (exit on listing, partial booking, or long-term hold) with top reasons.`;
}

/* ─── Robust JSON extraction ─── */

/**
 * Extract a JSON object from an LLM reply that may wrap it in ```json fences,
 * prose, or markdown code fences. Returns the parsed object or null.
 */
export function parseIpoReportJson(raw: string | null | undefined): IpoReport | null {
  if (!raw) return null;
  const text = raw.trim();

  // 1) Prefer the first ```json ... ``` fenced block (explicit model contract).
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;

  // 2) If that fails, try the outermost balanced {...} span.
  const tryParse = (str: string): IpoReport | null => {
    try {
      const obj = JSON.parse(str);
      return isValidReport(obj) ? obj : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const braceMatch = candidate.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    const fromBraces = tryParse(braceMatch[0]);
    if (fromBraces) return fromBraces;
  }

  return null;
}

/* ─── Schema validation (minimal — presence checks + safe coerce) ─── */

function isValidReport(value: unknown): value is IpoReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // A report is usable if we have either a company block or a verdict; we
  // coerce missing fields to safe defaults during normalization (see below).
  return typeof v === "object" && v !== null;
}

/**
 * Normalize an imperfect LLM object into a full `IpoReport` with safe defaults
 * for any missing/odd-typed field. Never throws.
 */
export function normalizeReport(input: unknown): IpoReport {
  const v = (input ?? {}) as Record<string, unknown>;
  const company = isObj(v.company) ? (v.company as Record<string, unknown>) : {};
  const verdict = isObj(v.verdict) ? (v.verdict as Record<string, unknown>) : {};
  const gmp = isObj(v.gmp) ? (v.gmp as Record<string, unknown>) : null;
  const sentiment = isObj(v.sentiment) ? (v.sentiment as Record<string, unknown>) : {};
  const financials = isObj(v.financials) ? (v.financials as Record<string, unknown>) : {};
  const peers = isObj(v.peers) ? (v.peers as Record<string, unknown>) : {};
  const futureGrowth = isObj(v.futureGrowth) ? (v.futureGrowth as Record<string, unknown>) : {};
  const listingStrategy = isObj(v.listingStrategy)
    ? (v.listingStrategy as Record<string, unknown>)
    : {};
  const finalScore = isObj(v.finalScore)
    ? (v.finalScore as Record<string, unknown>)
    : { outOf10: {}, total: 0 };

  return {
    company: {
      name: str(company.name, "N/A"),
      symbol: str(company.symbol, ""),
      sector: str(company.sector, "N/A"),
      businessModel: str(company.businessModel, ""),
      promoter: str(company.promoter, "N/A"),
      institutionalBacking: str(company.institutionalBacking, "N/A"),
    },
    summaryScores: arrOf(v.summaryScores).map((s) => {
      const o = isObj(s) ? (s as Record<string, unknown>) : {};
      return { label: str(o.label, ""), value: num(o.value, 0), tone: toneOf(o.tone) };
    }),
    verdict: {
      label: verdictLabel(str(verdict.label, "HOLD")),
      headline: str(verdict.headline, ""),
      reasons: arrOf(verdict.reasons).map(toString),
      confidencePct: clamp(num(verdict.confidencePct, 50), 0, 100),
    },
    quickSnapshots: arrOf(v.quickSnapshots).map((s) => {
      const o = isObj(s) ? (s as Record<string, unknown>) : {};
      return { label: str(o.label, ""), value: str(o.value, "") };
    }),
    businessOverview: str(v.businessOverview, ""),
    financials: {
      rating: ratingOf(str(financials.rating, "Average")),
      summary: str(financials.summary, ""),
      rows: arrOf(financials.rows).map((r) => {
        const o = isObj(r) ? (r as Record<string, unknown>) : {};
        return {
          metric: str(o.metric, ""),
          fy1: str(o.fy1, "—"),
          fy2: str(o.fy2, "—"),
          fy3: str(o.fy3, "—"),
        };
      }),
    },
    ipoDetails: arrOf(v.ipoDetails).map((d) => {
      const o = isObj(d) ? (d as Record<string, unknown>) : {};
      return { label: str(o.label, ""), value: str(o.value, "") };
    }),
    gmp: gmp
      ? {
          value: str(gmp.value, "—"),
          estimatedListingPrice: str(gmp.estimatedListingPrice, "—"),
          expectedGainPct: num(gmp.expectedGainPct, 0),
          trend: trendOf(str(gmp.trend, "Stable")),
          healthNote: str(gmp.healthNote, ""),
        }
      : null,
    news: arrOf(v.news).map((n) => {
      const o = isObj(n) ? (n as Record<string, unknown>) : {};
      return {
        date: str(o.date, ""),
        headline: str(o.headline, ""),
        tag: tagOf(str(o.tag, "Neutral")),
      };
    }),
    sentiment: {
      summary: str(sentiment.summary, ""),
      bullish: arrOf(sentiment.bullish).map(toString),
      bearish: arrOf(sentiment.bearish).map(toString),
      hypeDriven: Boolean(sentiment.hypeDriven),
    },
    peers: {
      valuation: valuationOf(str(peers.valuation, "Fairly Valued")),
      summary: str(peers.summary, ""),
      rows: arrOf(peers.rows).map((p) => {
        const o = isObj(p) ? (p as Record<string, unknown>) : {};
        return {
          name: str(o.name, ""),
          revenue: str(o.revenue, "—"),
          patMargin: str(o.patMargin, "—"),
          roe: str(o.roe, "—"),
          pe: str(o.pe, "—"),
          marketCap: str(o.marketCap, "—"),
        };
      }),
    },
    futureGrowth: {
      summary: str(futureGrowth.summary, ""),
      roadmap: arrOf(futureGrowth.roadmap).map(toString),
      oneYear: str(futureGrowth.oneYear, ""),
      threeYear: str(futureGrowth.threeYear, ""),
      fiveYear: str(futureGrowth.fiveYear, ""),
    },
    risks: arrOf(v.risks).map((r) => {
      const o = isObj(r) ? (r as Record<string, unknown>) : {};
      return {
        risk: str(o.risk, ""),
        level: levelOf(str(o.level, "Medium")),
        note: str(o.note, ""),
      };
    }),
    listingStrategy: {
      summary: str(listingStrategy.summary, ""),
      scenarios: arrOf(listingStrategy.scenarios).map((s) => {
        const o = isObj(s) ? (s as Record<string, unknown>) : {};
        return {
          scenario: str(o.scenario, ""),
          probability: clamp(num(o.probability, 0), 0, 100),
          play: str(o.play, ""),
        };
      }),
    },
    targets: arrOf(v.targets).map((t) => {
      const o = isObj(t) ? (t as Record<string, unknown>) : {};
      return {
        horizon: str(o.horizon, ""),
        bull: str(o.bull, "—"),
        base: str(o.base, "—"),
        bear: str(o.bear, "—"),
      };
    }),
    finalScore: {
      outOf10: isObj(finalScore.outOf10)
        ? mapToStringNum(finalScore.outOf10 as Record<string, unknown>)
        : {},
      total: clamp(Math.round(num(finalScore.total, 0)), 0, 100),
    },
    finalRecommendation: str(v.finalRecommendation, ""),
    disclaimer:
      str(v.disclaimer, "") ||
      "This AI report is for informational purposes only and is not investment advice. Always do your own research and consult a SEBI-registered advisor before investing.",
  };
}

/* ─── Internal coercion helpers (surgical, module-scoped) ─── */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function toString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function arrOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function toneOf(v: unknown): "green" | "amber" | "red" | undefined {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s.includes("green") || s === "great" || s === "strong") return "green";
  if (s.includes("red") || s === "poor" || s === "weak") return "red";
  if (s.includes("amber") || s === "ok" || s === "neutral") return "amber";
  return undefined;
}

function verdictLabel(
  v: string
): "STRONG BUY" | "BUY" | "HOLD" | "PARTIAL PROFIT BOOKING" | "EXIT ON LISTING" {
  const u = v.toUpperCase();
  if (u.includes("STRONG BUY")) return "STRONG BUY";
  if (u.includes("BUY")) return "BUY";
  if (u.includes("PARTIAL") || u.includes("PROFIT BOOKING")) return "PARTIAL PROFIT BOOKING";
  if (u.includes("EXIT")) return "EXIT ON LISTING";
  return "HOLD";
}

function ratingOf(v: string): "Excellent" | "Good" | "Average" | "Poor" {
  const u = v.toLowerCase();
  if (u.includes("excellent")) return "Excellent";
  if (u.includes("good")) return "Good";
  if (u.includes("poor")) return "Poor";
  return "Average";
}

function valuationOf(v: string): "Undervalued" | "Fairly Valued" | "Overvalued" {
  const u = v.toLowerCase();
  if (u.includes("under")) return "Undervalued";
  if (u.includes("over")) return "Overvalued";
  return "Fairly Valued";
}

function trendOf(v: string): "Increasing" | "Stable" | "Declining" {
  const u = v.toLowerCase();
  if (u.includes("increas") || u.includes("rising")) return "Increasing";
  if (u.includes("declin") || u.includes("falling")) return "Declining";
  return "Stable";
}

function levelOf(v: string): "Low" | "Medium" | "High" {
  const u = v.toLowerCase();
  if (u.includes("high")) return "High";
  if (u.includes("low")) return "Low";
  return "Medium";
}

function tagOf(v: string): "Positive" | "Negative" | "Neutral" {
  const u = v.toLowerCase();
  if (u.includes("posit")) return "Positive";
  if (u.includes("negat")) return "Negative";
  return "Neutral";
}

function mapToStringNum(rec: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(rec)) {
    const n = num(val, 0);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}
