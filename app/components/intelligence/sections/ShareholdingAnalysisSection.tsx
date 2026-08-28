"use client";

interface ShareholdingAnalysisSectionProps {
  analysis: {
    promoter: string;
    promoterPledge: string;
    fii: string;
    dii: string;
    interpretation: string;
  };
}

export default function ShareholdingAnalysisSection({ analysis }: ShareholdingAnalysisSectionProps) {
  const rows = [
    { label: "Promoter holding", value: analysis.promoter || "—" },
    { label: "Promoter pledge", value: analysis.promoterPledge || "—" },
    { label: "FII trend", value: analysis.fii || "—" },
    { label: "DII trend", value: analysis.dii || "—" },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="shareholding-analysis-section">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Shareholding Analysis</h4>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">{r.label}</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-100 text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
      {analysis.interpretation && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-slate-800 rounded p-2">
          <span className="font-medium">Interpretation: </span>{analysis.interpretation}
        </p>
      )}
    </div>
  );
}
