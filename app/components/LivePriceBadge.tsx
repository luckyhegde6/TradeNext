"use client";

import { useState, useEffect } from "react";
import { useLivePrice } from "@/lib/hooks/useLivePrice";
import clsx from "clsx";

interface Props {
  symbol: string;
  showChange?: boolean;
  showChangePercent?: boolean;
  showSymbol?: boolean;
  compact?: boolean;
  className?: string;
}

export default function LivePriceBadge({
  symbol,
  showChange = true,
  showChangePercent = true,
  showSymbol = false,
  compact = false,
  className,
}: Props) {
  const { price, change, changePercent, isLoading, isLive, error } = useLivePrice(symbol);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);

  // Flash animation on price change
  useEffect(() => {
    if (price !== null && prevPrice !== null && price !== prevPrice) {
      setFlash(price > prevPrice ? "up" : "down");
      const timer = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(timer);
    }
    if (price !== null) setPrevPrice(price);
  }, [price, prevPrice]);

  if (isLoading && price === null) {
    return (
      <span className={clsx("inline-flex items-center gap-1 text-gray-400", className)}>
        <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 animate-pulse" />
        {showSymbol && <span className="text-xs">{symbol}</span>}
        {!compact && <span className="text-xs">—</span>}
      </span>
    );
  }

  if (error && price === null) {
    return (
      <span className={clsx("inline-flex items-center gap-1 text-red-400", className)}>
        <span className="w-2 h-2 rounded-full bg-red-400" />
        {showSymbol && <span className="text-xs">{symbol}</span>}
        {!compact && <span className="text-xs">Error</span>}
      </span>
    );
  }

  const isPositive = change !== null && change >= 0;
  const isNegative = change !== null && change < 0;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 transition-colors duration-300",
        flash === "up" && "text-green-500",
        flash === "down" && "text-red-500",
        !flash && "text-gray-900 dark:text-white",
        className
      )}
    >
      {/* Live indicator dot */}
      {isLive && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" title="Live" />
      )}
      {!isLive && !error && (
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Polling" />
      )}

      {showSymbol && <span className="font-medium">{symbol}</span>}

      <span className={clsx("font-mono font-medium", compact ? "text-sm" : "text-base")}>
        {price !== null ? `₹${price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
      </span>

      {showChange && change !== null && (
        <span
          className={clsx(
            "font-mono text-xs",
            isPositive && "text-green-600 dark:text-green-400",
            isNegative && "text-red-600 dark:text-red-400"
          )}
        >
          {isPositive ? "+" : ""}
          {change.toFixed(2)}
        </span>
      )}

      {showChangePercent && changePercent !== null && (
        <span
          className={clsx(
            "font-mono text-xs",
            isPositive && "text-green-600 dark:text-green-400",
            isNegative && "text-red-600 dark:text-red-400"
          )}
        >
          ({isPositive ? "+" : ""}
          {changePercent.toFixed(2)}%)
        </span>
      )}

      {!compact && !isLive && !error && (
        <span className="text-[10px] text-gray-400 ml-1" title="Using polling">⏱</span>
      )}
    </span>
  );
}
