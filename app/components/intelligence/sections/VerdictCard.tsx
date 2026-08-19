"use client";

interface VerdictCardProps {
  verdict: "BUY" | "HOLD" | "SELL";
  confidence: number;
}

const VERDICT_STYLES: Record<string, { bg: string; text: string; border: string; emoji: string }> = {
  BUY: { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800", emoji: "🟢" },
  HOLD: { bg: "bg-amber-50 dark:bg-amber-900/20", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800", emoji: "🟡" },
  SELL: { bg: "bg-red-50 dark:bg-red-900/20", text: "text-red-700 dark:text-red-300", border: "border-red-200 dark:border-red-800", emoji: "🔴" },
};

export default function VerdictCard({ verdict, confidence }: VerdictCardProps) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.HOLD;
  return (
    <div className={`rounded-xl border-2 p-6 ${style.bg} ${style.border}`} data-testid="verdict-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Verdict</div>
          <div className={`text-3xl font-bold ${style.text} mt-1`}>
            {style.emoji} {verdict}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Confidence</div>
          <div className={`text-2xl font-bold ${style.text} mt-1`}>{confidence}%</div>
          <div className="w-24 h-2 bg-gray-200 dark:bg-slate-700 rounded-full mt-2">
            <div
              className={`h-2 rounded-full ${verdict === "BUY" ? "bg-emerald-500" : verdict === "SELL" ? "bg-red-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min(100, Math.max(0, confidence))}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
