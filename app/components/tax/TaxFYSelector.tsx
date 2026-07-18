"use client";

interface Props {
  years: string[];
  selected: string;
  onChange: (fy: string) => void;
}

export default function TaxFYSelector({ years, selected, onChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Financial Year:
      </label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-sm font-medium"
      >
        {years.map((fy) => (
          <option key={fy} value={fy}>
            FY {fy}
          </option>
        ))}
      </select>
    </div>
  );
}
