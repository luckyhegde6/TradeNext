"use client";

interface TechnicalStructureSectionProps {
  structure: {
    trend: string;
    priceVs50: string;
    priceVs200: string;
    rsi: string;
    volume: string;
    support: number | null;
    resistance: number | null;
    marketPhase: string;
    verdict: string;
  };
}

const PHASE_STYLE: Record<string, string> = {
  ACCUMULATION: "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300",
  MARKUP: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  DISTRIBUTION: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  MARKDOWN: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  BASE: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
  UNKNOWN: "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400",
};

export default function TechnicalStructureSection({ structure }: TechnicalStructureSectionProps) {
  const rows = [
    { label: "Trend", value: structure.trend },
    { label: "Price vs 50 DMA", value: structure.priceVs50 },
    { label: "Price vs 200 DMA", value: structure.priceVs200 },
    { label: "RSI", value: structure.rsi },
    { label: "Volume", value: structure.volume },
    { label: "Support / Resistance", value: `${structure.support != null ? `₹${structure.support.toLocaleString()}` : "—"} / ${structure.resistance != null ? `₹${structure.resistance.toLocaleString()}` : "—"}` },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="technical-structure-section">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Technical Structure</h4>
        <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-semibold ${PHASE_STYLE[structure.marketPhase] ?? PHASE_STYLE.UNKNOWN}`}>
          {structure.marketPhase}
        </span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">{r.label}</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-100 text-right">{r.value || "—"}</dd>
          </div>
        ))}
      </dl>
      {structure.verdict && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-slate-800 rounded p-2">
          <span className="font-medium">Verdict: </span>{structure.verdict}
        </p>
      )}
    </div>
  );
}
