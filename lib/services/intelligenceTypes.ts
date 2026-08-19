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

// ─── AI Analysis Response ─────────────────────────────────────────────────────

export interface IntelligenceAnalysis {
  verdict: "BUY" | "HOLD" | "SELL";
  confidence: number;
  fairValue: {
    low: number;
    mid: number;
    high: number;
  };
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
  riskFactors: string[];
  catalysts: string[];
  scenarioAnalysis: {
    bull: string;
    base: string;
    bear: string;
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
