"use client";

import type { ContrarianView } from "@/lib/services/intelligenceTypes";

interface ContrarianSectionProps {
  contrarian: ContrarianView;
  whatWouldChangeMyMind?: string[];
}

export default function ContrarianSection({ contrarian, whatWouldChangeMyMind }: ContrarianSectionProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="contrarian-section">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Contrarian Test</h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-50 dark:bg-slate-800 rounded p-3">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Market belief</div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{contrarian.marketBelief}</p>
        </div>
        <div className="bg-gray-50 dark:bg-slate-800 rounded p-3">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">What if the market is right?</div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{contrarian.whatIfWrong}</p>
        </div>
      </div>

      {contrarian.supporting.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">Supports the contrarian view</div>
          <ul className="space-y-1">
            {contrarian.supporting.map((s, i) => (
              <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                <span className="text-emerald-500 mt-0.5">✓</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {contrarian.contradicting.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Contradicts the contrarian view</div>
          <ul className="space-y-1">
            {contrarian.contradicting.map((c, i) => (
              <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                <span className="text-red-500 mt-0.5">✗</span> {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {whatWouldChangeMyMind && whatWouldChangeMyMind.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">What would change my mind</div>
          <ul className="space-y-1">
            {whatWouldChangeMyMind.map((w, i) => (
              <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                <span className="text-purple-500 mt-0.5">⟳</span> {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
