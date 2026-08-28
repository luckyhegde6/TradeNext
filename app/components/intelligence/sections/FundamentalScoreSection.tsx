"use client";

import type { EvidenceLabel } from "@/lib/services/intelligenceTypes";

interface FundamentalScoreSectionProps {
  score: {
    score: number;
    revenue: string;
    profit: string;
    margins: string;
    cashFlow: string;
    balanceSheet: string;
    roe: string;
    accountingQuality: string;
    verdict: string;
    evidence: { label: EvidenceLabel; text: string; period?: string; source?: string }[];
  };
}

const EVIDENCE_STYLE: Record<EvidenceLabel, string> = {
  VERIFIED_FACT: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  CALCULATED_METRIC: "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300",
  ANALYST_INTERPRETATION: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  INVESTMENT_INFERENCE: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
};

function evidenceTag(e: { label: EvidenceLabel }): string {
  switch (e.label) {
    case "VERIFIED_FACT": return "FACT";
    case "CALCULATED_METRIC": return "METRIC";
    case "ANALYST_INTERPRETATION": return "INTERPRET";
    case "INVESTMENT_INFERENCE": return "INFER";
    default: return e.label;
  }
}

export default function FundamentalScoreSection({ score }: FundamentalScoreSectionProps) {
  const rows = [
    { label: "Revenue", value: score.revenue || "—" },
    { label: "Profit", value: score.profit || "—" },
    { label: "Margins", value: score.margins || "—" },
    { label: "Cash flow", value: score.cashFlow || "—" },
    { label: "Balance sheet", value: score.balanceSheet || "—" },
    { label: "ROE", value: score.roe || "—" },
    { label: "Accounting quality", value: score.accountingQuality || "—" },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="fundamental-score-section">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Fundamental Score</h4>
        <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Score {score.score}/10</span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">{r.label}</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-100 text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
      {score.verdict && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-slate-800 rounded p-2">
          <span className="font-medium">Verdict: </span>{score.verdict}
        </p>
      )}
      {score.evidence.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Evidence</div>
          <ul className="space-y-1.5">
            {score.evidence.map((e, i) => (
              <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold ${EVIDENCE_STYLE[e.label]}`}>
                  {evidenceTag(e)}
                </span>
                <span className="flex-1">
                  {e.text}
                  {e.period ? <span className="text-gray-400 dark:text-gray-500"> ({e.period})</span> : null}
                  {e.source ? <span className="text-gray-400 dark:text-gray-500"> · {e.source}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
