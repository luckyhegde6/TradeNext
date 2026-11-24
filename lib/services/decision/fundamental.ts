// lib/services/decision/fundamental.ts
// Investment-banker perspective — fundamental analysis over NSE company data
// (profile + financial results + corporate actions), using existing services.
// Pure, deterministic, defensive (null-safe fields).

import type { DecisionConclusion } from "./types";

export interface IBFundamentals {
  /** Margin trend from the latest f-score inputs (when available). */
  marginTrend?: string;
  /** Debt-equity ratio from company data (when available). */
  debtEquity?: number;
  /** Return on equity from financials (when available). */
  roe?: number;
}

/** IB view string from fundamentals. */
export function ibView(f: IBFundamentals): string {
  const bits: string[] = [];
  if (f.debtEquity !== undefined) bits.push(`DE/EQ ${f.debtEquity.toFixed(2)}`);
  if (f.roe !== undefined) bits.push(`ROE ${(f.roe * 100).toFixed(1)}%`);
  if (f.marginTrend) bits.push(f.marginTrend);
  return bits.join(" · ") || "fundamentals unavailable";
}

export async function runFundamentalAnalysis(symbol: string): Promise<IBFundamentals> {
  const out: IBFundamentals = {};
  try {
    const { getCompanyData } = await import("@/lib/services/companyService");
    const data = await getCompanyData(symbol);
    const anyData = data as unknown as Record<string, unknown>;
    const de = asNum(anyData["debtToEquity"] ?? anyData["debtEquity"] ?? anyData["de"]);
    if (de !== undefined) out.debtEquity = de;
  } catch {
    /* fundamentals are optional — never throw */
  }
  try {
    const { getFinancialScore } = await import("@/lib/services/fscore-service");
    const f = await getFinancialScore(symbol);
    if (f) out.marginTrend = f.breakdown?.[0]?.passed ? "margins improving" : "margins weak";
  } catch {
    /* optional */
  }
  return out;
}

function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export type { DecisionConclusion };
