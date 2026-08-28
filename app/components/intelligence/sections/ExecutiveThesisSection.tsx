"use client";

interface ExecutiveThesisSectionProps {
  thesis?: {
    oneSentenceThesis: string;
    threeBiggestReasons: string[];
  };
}

export default function ExecutiveThesisSection({ thesis }: ExecutiveThesisSectionProps) {
  if (!thesis) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-5" data-testid="executive-thesis-section">
      <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Thesis</h4>
      <p className="text-sm text-gray-800 dark:text-gray-100 font-medium leading-relaxed">{thesis.oneSentenceThesis}</p>
      {thesis.threeBiggestReasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {thesis.threeBiggestReasons.map((r, i) => (
            <li key={i} className="text-sm text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
              <span className="text-slate-400 mt-0.5 font-semibold">{i + 1}.</span> {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
