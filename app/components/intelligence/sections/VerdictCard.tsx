"use client";

import type { Verdict } from "@/lib/services/intelligenceTypes";

interface VerdictCardProps {
  verdict: Verdict;
  confidence: number;
  conviction?: number;
}

const VERDICT_STYLES: Record<Verdict, { bg: string; text: string; border: string; emoji: string; bar: string }> = {
  STRONG_BUY: { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-700", emoji: "🟢", bar: "bg-emerald-600" },
  BUY: { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800", emoji: "🟢", bar: "bg-emerald-500" },
  ACCUMULATE: { bg: "bg-teal-50 dark:bg-teal-900/20", text: "text-teal-700 dark:text-teal-300", border: "border-teal-200 dark:border-teal-800", emoji: "📈", bar: "bg-teal-500" },
  HOLD: { bg: "bg-amber-50 dark:bg-amber-900/20", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800", emoji: "🟡", bar: "bg-amber-500" },
  REDUCE: { bg: "bg-orange-50 dark:bg-orange-900/20", text: "text-orange-700 dark:text-orange-300", border: "border-orange-200 dark:border-orange-800", emoji: "📉", bar: "bg-orange-500" },
  SELL: { bg: "bg-red-50 dark:bg-red-900/20", text: "text-red-600 dark:text-red-400", border: "border-red-200 dark:border-red-800", emoji: "🔴", bar: "bg-red-500" },
  STRONG_SELL: { bg: "bg-red-50 dark:bg-red-900/20", text: "text-red-700 dark:text-red-300", border: "border-red-300 dark:border-red-700", emoji: "🔴", bar: "bg-red-600" },
  AVOID: { bg: "bg-gray-100 dark:bg-slate-800", text: "text-gray-700 dark:text-gray-300", border: "border-gray-300 dark:border-slate-600", emoji: "⛔", bar: "bg-gray-500" },
};

export default function VerdictCard({ verdict, confidence, conviction }: VerdictCardProps) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.HOLD;
  const conv = conviction ?? Math.round((confidence / 100) * 10);

  return (
    <div className={`rounded-xl border-2 p-6 ${style.bg} ${style.border}`} data-testid="verdict-card">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Verdict</div>
          <div className={`text-2xl sm:text-3xl font-bold ${style.text} mt-1`}>
            {style.emoji} {verdict.replace("_", " ")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Confidence</div>
          <div className={`text-2xl font-bold ${style.text} mt-1`}>{confidence}%</div>
          <div className="w-24 h-2 bg-gray-200 dark:bg-slate-700 rounded-full mt-2">
            <div
              className={`h-2 rounded-full ${style.bar}`}
              style={{ width: `${Math.min(100, Math.max(0, confidence))}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>Conviction</span>
          <span>{conv}/10</span>
        </div>
        <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-700 rounded-full">
          <div
            className={`h-1.5 rounded-full ${style.bar}`}
            style={{ width: `${Math.min(100, Math.max(0, conv * 10))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
