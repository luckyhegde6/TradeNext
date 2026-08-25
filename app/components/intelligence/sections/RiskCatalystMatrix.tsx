"use client";

interface RiskCatalystMatrixProps {
  riskFactors: string[];
  catalysts: string[];
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
            <ul className="space-y-1">
              {riskFactors.map((r, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                  <span className="text-red-500 mt-0.5">⚠</span> {r}
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
