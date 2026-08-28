"use client";

import type { ManagementDna } from "@/lib/services/intelligenceTypes";

interface ManagementDnaSectionProps {
  dna: ManagementDna;
}

export default function ManagementDnaSection({ dna }: ManagementDnaSectionProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="management-dna-section">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Management DNA</h4>
        <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
          Score {dna.score}/10
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {dna.positives.length > 0 && (
          <div>
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1.5">Positives</div>
            <ul className="space-y-1">
              {dna.positives.map((p, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                  <span className="text-emerald-500 mt-0.5">✓</span> {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {dna.concerns.length > 0 && (
          <div>
            <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-1.5">Concerns</div>
            <ul className="space-y-1">
              {dna.concerns.map((c, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                  <span className="text-red-500 mt-0.5">⚠</span> {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-slate-800 rounded p-2">
          <span className="text-gray-500 dark:text-gray-400">Guidance: </span>
          <span className="font-medium text-gray-700 dark:text-gray-200 capitalize">{dna.guidanceCredibility}</span>
        </div>
        <div className="bg-gray-50 dark:bg-slate-800 rounded p-2 sm:col-span-1">
          <span className="text-gray-500 dark:text-gray-400">Capital allocation: </span>
          <span className="font-medium text-gray-700 dark:text-gray-200">{dna.capitalAllocation}</span>
        </div>
        <div className="bg-gray-50 dark:bg-slate-800 rounded p-2 sm:col-span-3">
          <span className="text-gray-500 dark:text-gray-400">Promoter behavior: </span>
          <span className="font-medium text-gray-700 dark:text-gray-200">{dna.promoterBehavior}</span>
        </div>
      </div>

      {dna.verdict && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-slate-800 rounded p-2">
          <span className="font-medium">Verdict: </span>{dna.verdict}
        </p>
      )}
    </div>
  );
}
