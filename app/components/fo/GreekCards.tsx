"use client";

import { OptionGreeks } from "@/lib/services/foPnlService";

interface GreekCardsProps {
  greeks: OptionGreeks;
  direction?: "LONG" | "SHORT";
}

/**
 * Option Greek cards — Delta, Gamma, Theta, Vega, Rho for a selected position.
 * Delta/Theta signs flip for SHORT positions (risk view from the trader's side).
 */
export default function GreekCards({ greeks, direction = "LONG" }: GreekCardsProps) {
  const sign = direction === "SHORT" ? -1 : 1;

  const cards = [
    { label: "Delta", value: greeks.delta, desc: "Price sensitivity to ₹1 underlying move", sign },
    { label: "Gamma", value: greeks.gamma, desc: "Rate of delta change", sign: 1 },
    { label: "Theta (per day)", value: greeks.theta, desc: "Time decay", sign },
    { label: "Vega", value: greeks.vega, desc: "Sensitivity to 1% IV change", sign },
    { label: "Rho", value: greeks.rho, desc: "Sensitivity to 1% rate change", sign },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => {
        const adjusted = c.value * c.sign;
        return (
          <div
            key={c.label}
            className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-3"
          >
            <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{c.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${
              adjusted > 0 ? "text-green-600 dark:text-green-400" :
              adjusted < 0 ? "text-red-600 dark:text-red-400" :
              "text-gray-600 dark:text-gray-400"
            }`}>
              {adjusted.toFixed(4)}
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{c.desc}</p>
          </div>
        );
      })}
    </div>
  );
}
