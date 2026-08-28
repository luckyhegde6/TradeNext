"use client";

import type { PortfolioAction } from "@/lib/services/intelligenceTypes";

interface PortfolioActionSectionProps {
  action: PortfolioAction;
  invalidation?: {
    thesisInvalidation: string;
    entryZone: string;
    fairZone: string;
    overZone: string;
    holdingHorizon: string;
  };
}

const SIZING_STYLE: Record<PortfolioAction["positionSizing"], string> = {
  CORE: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  SATELLITE: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300",
  SPECULATIVE: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  WATCHLIST: "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300",
  NONE: "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400",
};

export default function PortfolioActionSection({ action, invalidation }: PortfolioActionSectionProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="portfolio-action-section">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Portfolio Action</h4>
        <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-semibold ${SIZING_STYLE[action.positionSizing]}`}>
          {action.positionSizing}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="bg-gray-50 dark:bg-slate-800 rounded p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">Existing holder</div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100 mt-0.5">{action.existingHolder}</div>
        </div>
        <div className="bg-gray-50 dark:bg-slate-800 rounded p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">New investor</div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100 mt-0.5">{action.newInvestor}</div>
        </div>
      </div>

      {invalidation && (
        <div className="space-y-2 text-xs">
          <div className="bg-gray-50 dark:bg-slate-800 rounded p-2">
            <span className="text-red-600 dark:text-red-400 font-medium">Thesis invalidation: </span>
            <span className="text-gray-700 dark:text-gray-300">{invalidation.thesisInvalidation}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded p-2">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Entry zone: </span>
              <span className="text-gray-700 dark:text-gray-300">{invalidation.entryZone}</span>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded p-2">
              <span className="text-amber-600 dark:text-amber-400 font-medium">Fair zone: </span>
              <span className="text-gray-700 dark:text-gray-300">{invalidation.fairZone}</span>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded p-2">
              <span className="text-red-600 dark:text-red-400 font-medium">Over zone: </span>
              <span className="text-gray-700 dark:text-gray-300">{invalidation.overZone}</span>
            </div>
            <div className="bg-gray-50 dark:bg-slate-800 rounded p-2">
              <span className="text-gray-500 dark:text-gray-400 font-medium">Horizon: </span>
              <span className="text-gray-700 dark:text-gray-300">{invalidation.holdingHorizon}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
