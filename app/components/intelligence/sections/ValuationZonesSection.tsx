"use client";

import type { ValuationZones } from "@/lib/services/intelligenceTypes";

interface ValuationZonesSectionProps {
  zones: ValuationZones;
  currentPrice?: number;
}

function fmt(n?: number): string {
  return n != null ? `₹${n.toLocaleString()}` : "—";
}

export default function ValuationZonesSection({ zones, currentPrice }: ValuationZonesSectionProps) {
  const low = zones.attractiveLow ?? null;
  const high = zones.overHigh ?? null;
  const hasBounds = low != null && high != null && high > low;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="valuation-zones-section">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Valuation Zones</h4>

      {hasBounds && (
        <div className="mb-3">
          <div className="relative h-3 rounded-full overflow-hidden flex">
            <div className="bg-emerald-500/70 dark:bg-emerald-600/50" style={{ width: "33%" }} />
            <div className="bg-amber-500/70 dark:bg-amber-600/50" style={{ width: "34%" }} />
            <div className="bg-red-500/70 dark:bg-red-600/50" style={{ width: "33%" }} />
          </div>
          <div className="relative h-5 mt-1">
            {currentPrice != null && currentPrice >= low && currentPrice <= high && (
              <div
                className="absolute -top-1 w-0.5 h-5 bg-slate-800 dark:bg-white"
                style={{ left: `${((currentPrice - low) / (high - low)) * 100}%` }}
                title={`Current ₹${currentPrice}`}
              />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
            <span>Attractive {fmt(low)} — {fmt(zones.attractiveHigh)}</span>
            <span>Fair {fmt(zones.fairLow)} — {fmt(zones.fairHigh)}</span>
            <span>Over {fmt(zones.overLow)} — {fmt(high)}</span>
          </div>
        </div>
      )}

      {!hasBounds && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 text-xs">
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded p-2">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Attractive </span>
            <span className="text-gray-700 dark:text-gray-300">{fmt(zones.attractiveLow)} — {fmt(zones.attractiveHigh)}</span>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded p-2">
            <span className="text-amber-600 dark:text-amber-400 font-medium">Fair </span>
            <span className="text-gray-700 dark:text-gray-300">{fmt(zones.fairLow)} — {fmt(zones.fairHigh)}</span>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded p-2">
            <span className="text-red-600 dark:text-red-400 font-medium">Overvalued </span>
            <span className="text-gray-700 dark:text-gray-300">{fmt(zones.overLow)} — {fmt(zones.overHigh)}</span>
          </div>
        </div>
      )}

      {zones.assumptions.length > 0 && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium">Assumptions: </span>
          {zones.assumptions.join(" · ")}
        </div>
      )}
    </div>
  );
}
