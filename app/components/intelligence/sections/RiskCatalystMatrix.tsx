"use client";

import type { RiskItem } from "@/lib/services/intelligenceTypes";

interface RiskCatalystMatrixProps {
  riskFactors: RiskItem[];
  catalysts: string[];
}

const CATEGORY_STYLE: Record<RiskItem["category"], string> = {
  COMPANY: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  SECTOR: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
  MACRO: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
};

const PROB_STYLE: Record<string, string> = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-emerald-600 dark:text-emerald-400",
};

function probLevel(p: string): string {
  const v = p.toLowerCase();
  if (v.includes("%")) {
    const n = parseInt(v, 10);
    if (n >= 60) return "high";
    if (n >= 30) return "medium";
    return "low";
  }
  if (v.includes("high")) return "high";
  if (v.includes("med")) return "medium";
  return "low";
}

export default function RiskCatalystMatrix({ riskFactors, catalysts }: RiskCatalystMatrixProps) {
  const hasData = riskFactors.length > 0 || catalysts.length > 0;
  if (!hasData) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="risk-catalyst-matrix">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Risks &amp; Catalysts</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {riskFactors.length > 0 && (
          <div>
            <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-2">Risk Factors</div>
            <ul className="space-y-2">
              {riskFactors.map((r, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300">
                  <div className="flex items-start gap-1.5">
                    <span className="text-red-500 mt-0.5">⚠</span>
                    <span className="flex-1">
                      {r.risk}
                      {r.pricedIn === true && (
                        <span className="ml-1.5 text-[10px] uppercase text-gray-400 dark:text-gray-500">priced-in</span>
                      )}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_STYLE[r.category]}`}>{r.category}</span>
                  </div>
                  <div className="pl-5 mt-1 text-xs text-gray-400 dark:text-gray-500">
                    <span className={PROB_STYLE[probLevel(r.probability)]}>Prob: {r.probability}</span>
                    {" · "}Impact: {r.impact}
                    {r.earlyWarning ? ` · ⚑ ${r.earlyWarning}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {catalysts.length > 0 && (
          <div>
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2">Catalysts</div>
            <ul className="space-y-1">
              {catalysts.map((c, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">🚀</span> {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
