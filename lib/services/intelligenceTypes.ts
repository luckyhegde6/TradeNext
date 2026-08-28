// lib/services/intelligenceTypes.ts — TypeScript interfaces for AI Investment Intelligence
//
// All data shapes for the intelligence report: NSE adapter outputs, AI analysis
// response, and the full report envelope. No runtime dependencies.

// ─── NSE Adapter Output Types ────────────────────────────────────────────────

export interface QuoteData {
  symbol: string;
  price: number;
  change: number;
  percentChange: number;
  pe: number | null;
  pb: number | null;
  marketCap: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  volume: number;
  vwAP: number | null;
  sector: string;
  industry: string;
  faceValue: number | null;
  bookValue: number | null;
  eps: number | null;
  dividendYield: number | null;
}

export interface TechnicalsData {
  currentTrend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  atr14: number | null;
  support: number | null;
  resistance: number | null;
  trendStrength: string;
  indicatorSummary: string;
}

export interface ValuationData {
  pe: number | null;
  pb: number | null;
  evEbitda: number | null;
  peg: number | null;
  dividendYield: number | null;
  sectorMedianPe: number | null;
  relativeValue: string;
  valuationAssessment: string;
}

export interface FundamentalsData {
  creditRating: string | null;
  interestCoverage: number | null;
  debtToEquity: number | null;
  roce: number | null;
  roe: number | null;
  netWorth: number | null;
  totalDebt: number | null;
  quarterlyResults: QuarterlyResult[];
  profitTrend: string;
  revenueTrend: string;
  workingCapitalTrend: string;
}

export interface QuarterlyResult {
  period: string;
  revenue: number | null;
  profit: number | null;
  eps: number | null;
}

export interface ShareholdingData {
  promoters: number | null;
  fiis: number | null;
  diis: number | null;
  public: number | null;
  others: number | null;
  qoqChanges: {
    promoters: number;
    fiis: number;
    diis: number;
    public: number;
  };
  fiiTrend: string;
  diiTrend: string;
  promoterPledge: number | null;
}

export interface CorporateData {
  recentActions: Array<{
    type: string;
    date: string;
    details: string;
  }>;
  upcomingEvents: Array<{
    type: string;
    date: string;
    details: string;
  }>;
  keyAnnouncements: Array<{
    title: string;
    date: string;
    category: string;
  }>;
  governanceSignals: string[];
}

export interface NewsData {
  recentNews: Array<{
    title: string;
    source: string;
    date: string;
  }>;
  announcementsByCategory: Record<string, number>;
}

export interface PeersData {
  peers: Array<{
    symbol: string;
    price: number;
    pe: number | null;
    marketCap: number;
  }>;
}

// ─── Intelligence Input (all adapter outputs combined) ────────────────────────

export interface IntelligenceInput {
  quote: QuoteData | null;
  technicals: TechnicalsData | null;
  valuation: ValuationData | null;
  fundamentals: FundamentalsData | null;
  shareholding: ShareholdingData | null;
  corporate: CorporateData | null;
  news: NewsData | null;
  peers: PeersData | null;
  symbol: string;
}

// ─── Stock Analysis (equity research decision engine) types ──────────────────

/** Eight-level investment verdict (professional equity-research stance). */
export type Verdict =
  | "STRONG_BUY"
  | "BUY"
  | "ACCUMULATE"
  | "HOLD"
  | "REDUCE"
  | "SELL"
  | "STRONG_SELL"
  | "AVOID";

/** Evidence discipline — every conclusion is tagged so facts are never passed off as opinions. */
export type EvidenceLabel =
  | "VERIFIED_FACT"
  | "CALCULATED_METRIC"
  | "ANALYST_INTERPRETATION"
  | "INVESTMENT_INFERENCE";

/** Wyckoff-style market phase of the technical structure. */
export type MarketPhase =
  | "ACCUMULATION"
  | "MARKUP"
  | "DISTRIBUTION"
  | "MARKDOWN"
  | "BASE"
  | "UNKNOWN";

export interface EvidencePoint {
  label: EvidenceLabel;
  text: string;
  period?: string; // reporting period / time context (e.g. "FY25", "Q1FY26", "2026-08-28")
  source?: string; // where the fact came from (e.g. "NSE quote", "User annual report", "Concall")
}

export interface ManagementDna {
  score: number; // 0-10
  positives: string[];
  concerns: string[];
  guidanceCredibility: "conservative" | "reliable" | "promotional" | "unclear" | "unknown";
  capitalAllocation: string;
  promoterBehavior: string; // includes pledge status
  verdict: string;
}

export interface ValuationZones {
  attractiveLow?: number;
  attractiveHigh?: number;
  fairLow?: number;
  fairHigh?: number;
  overLow?: number;
  overHigh?: number;
  assumptions: string[];
}

export interface RiskItem {
  risk: string;
  category: "COMPANY" | "SECTOR" | "MACRO";
  probability: string; // qualitative (low/medium/high) or %
  impact: string;      // qualitative
  earlyWarning: string;
  pricedIn: boolean;
}

export interface ContrarianView {
  marketBelief: string;
  whatIfWrong: string;
  supporting: string[];
  contradicting: string[];
}

export interface PortfolioAction {
  existingHolder: string; // hold / add gradually / trim / exit
  newInvestor: string;    // initiate now / buy gradually / wait / avoid
  positionSizing: "CORE" | "SATELLITE" | "SPECULATIVE" | "WATCHLIST" | "NONE";
}

// ─── AI Analysis Response ─────────────────────────────────────────────────────

/**
 * The full institutional investment-memorandum analysis produced by the LLM.
 * Backward-compatible: legacy 3-verdict reports parse into this shape via
 * defaults (verdict BUY/HOLD/SELL map onto the 8-level enum; new fields defaulted).
 *
 * NOTE: the "new framework" fields below are OPTIONAL (`?`) so that legacy rows
 * already persisted in `IntelligenceCache` (which lack them) remain valid at
 * runtime without a schema migration. The parser always populates them for NEW
 * reports, and the UI null-coalesces for legacy rows.
 */
export interface IntelligenceAnalysis {
  // ── Decision ──────────────────────────────────────────────────────────────
  verdict: Verdict;
  conviction?: number; // 0-10 (new)
  confidence: number; // 0-100 (kept for continuity, derived from conviction)
  fairValue: {
    low: number;
    mid: number;
    high: number;
  };
  valuationZones?: ValuationZones; // (new)

  // ── Executive summary (new) ───────────────────────────────────────────────
  executiveSummary?: {
    oneSentenceThesis: string;
    threeBiggestReasons: string[];
  };

  // ── Pillar 1: Fundamentals (new) ──────────────────────────────────────────
  fundamentalScore?: {
    score: number; // 0-10
    revenue: string;
    profit: string;
    margins: string;
    cashFlow: string;
    balanceSheet: string;
    roe: string;
    accountingQuality: string;
    verdict: string;
    evidence: EvidencePoint[];
  };

  // ── Pillar 2: Management DNA (new) ────────────────────────────────────────
  managementDna?: ManagementDna;

  // ── Pillar 3: Valuation reality (new) ─────────────────────────────────────
  valuationReality?: {
    current: string;
    historical: string;
    peer: string;
    growthAdjusted: string;
    conclusion: string; // CHEAP | FAIRLY VALUED | EXPENSIVE | EXTREMELY EXPENSIVE
  };

  // ── Pillar 4: Technical structure (new) ───────────────────────────────────
  technicalStructure?: {
    trend: string;
    priceVs50: string;
    priceVs200: string;
    rsi: string;
    volume: string;
    support: number | null;
    resistance: number | null;
    marketPhase: MarketPhase;
    verdict: string;
  };

  // ── Pillar 5: Shareholding (new) ──────────────────────────────────────────
  shareholdingAnalysis?: {
    promoter: string;
    promoterPledge: string;
    fii: string;
    dii: string;
    interpretation: string;
  };

  // ── Pillar 6: Risks + catalysts ───────────────────────────────────────────
  riskFactors: RiskItem[];
  catalysts: string[];

  // ── Scenarios (new) ───────────────────────────────────────────────────────
  scenarioAnalysis: {
    bull: string;
    base: string;
    bear: string;
  };
  contrarian?: ContrarianView;
  whatWouldChangeMyMind?: string[];

  // ── Portfolio action + invalidation (new) ─────────────────────────────────
  portfolioAction?: PortfolioAction;
  invalidation?: {
    thesisInvalidation: string;
    entryZone: string;
    fairZone: string;
    overZone: string;
    holdingHorizon: string;
  };

  // ── Honesty / gaps (new) ──────────────────────────────────────────────────
  dataGaps?: string[];

  // ── Legacy / compatible ───────────────────────────────────────────────────
  technicalAnalysis: {
    trend: string;
    support: number | null;
    resistance: number | null;
    indicators: string;
  };
  fundamentalAnalysis: {
    strengths: string[];
    weaknesses: string[];
  };
  valuationAssessment: {
    assessment: string;
    relativeValue: string;
  };
  newsCatalysts: {
    positive: string[];
    negative: string[];
    neutral: string[];
  };
  shareholdingTrend: {
    summary: string;
  };
  summary: string;
}

// ─── Full Intelligence Report ─────────────────────────────────────────────────

export interface IntelligenceReport {
  symbol: string;
  analysis: IntelligenceAnalysis;
  dataUsed: IntelligenceInput;
  modelUsed: string | null;
  generatedAt: string;
  version: number;
  isCacheHit: boolean;
}
