"use client";

import { useState } from "react";
import { AllocationCategory, DEFAULT_SECTOR_TARGETS } from "@/lib/services/rebalancerTypes";

interface Props {
  categories: AllocationCategory[];
  onChange: (categories: AllocationCategory[]) => void;
}

export default function TargetAllocationEditor({ categories, onChange }: Props) {
  const [localCats, setLocalCats] = useState<AllocationCategory[]>(categories.length > 0 ? categories : DEFAULT_SECTOR_TARGETS);

  const updateCat = (index: number, field: keyof AllocationCategory, value: any) => {
    const updated = localCats.map((c, i) => (i === index ? { ...c, [field]: value } : c));
    setLocalCats(updated);
    onChange(updated);
  };

  const addCategory = () => {
    const updated = [...localCats, { name: "New Category", targetPercent: 5, type: "sector" as const }];
    setLocalCats(updated);
    onChange(updated);
  };

  const removeCategory = (index: number) => {
    const updated = localCats.filter((_, i) => i !== index);
    setLocalCats(updated);
    onChange(updated);
  };

  const resetToDefaults = () => {
    setLocalCats(DEFAULT_SECTOR_TARGETS);
    onChange(DEFAULT_SECTOR_TARGETS);
  };

  const total = localCats.reduce((s, c) => s + c.targetPercent, 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
      <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Target Allocation</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={resetToDefaults}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Reset
          </button>
          <button
            onClick={addCategory}
            className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Total progress */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Total Allocation</span>
          <span className={`text-xs font-mono font-medium ${
            total === 100 ? "text-green-600 dark:text-green-400" :
            total > 100 ? "text-red-600 dark:text-red-400" :
            "text-yellow-600 dark:text-yellow-400"
          }`}>
            {total.toFixed(1)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-slate-600 rounded-full h-2">
          <div
            className={`h-full rounded-full transition-all ${
              total <= 100 ? "bg-blue-500" : "bg-red-500"
            }`}
            style={{ width: `${Math.min(total, 100)}%` }}
          />
        </div>
        {total !== 100 && (
          <p className="text-xs text-gray-400 mt-1">
            {total < 100 ? `Unallocated: ${(100 - total).toFixed(1)}%` : `Exceeds 100% by ${(total - 100).toFixed(1)}%`}
          </p>
        )}
      </div>

      {/* Category rows */}
      <div className="p-4 space-y-3">
        {localCats.map((cat, i) => (
          <div key={i} className="flex items-center gap-3">
            <input
              type="text"
              value={cat.name}
              onChange={(e) => updateCat(i, "name", e.target.value)}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              placeholder="Category name"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={cat.targetPercent}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v >= 0) updateCat(i, "targetPercent", v);
                }}
                className="w-20 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-right font-mono"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
            <button
              onClick={() => removeCategory(i)}
              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title="Remove"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
