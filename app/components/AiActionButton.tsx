"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";

interface AiActionButtonProps {
  /** Button label text */
  children: ReactNode;
  /** Click handler that should return the X-RateLimit-Remaining value (or null if unknown) */
  onClick: () => Promise<{ remaining: number | null; limit: number | null } | void>;
  /** Optional override for loading state */
  loading?: boolean;
  /** Optional override for disabled state */
  disabled?: boolean;
  /** Small variant for inline use (default: normal) */
  size?: "normal" | "small";
  /** Optional className override */
  className?: string;
}

/**
 * AiActionButton — Prominent purple gradient button for AI-powered actions.
 *
 * Features:
 * - Eye-catching purple gradient with sparkle icon
 * - After each click, shows rate limit status as a live badge
 * - Disables and shows cooldown message when rate limit is hit
 * - Loading spinner during execution
 */
export default function AiActionButton({
  children,
  onClick,
  loading: externalLoading,
  disabled: externalDisabled,
  size = "normal",
  className,
}: AiActionButtonProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const [rateInfo, setRateInfo] = useState<{
    remaining: number;
    limit: number;
    timestamp: number;
  } | null>(null);

  const isLoading = externalLoading ?? internalLoading;
  const isDisabled = externalDisabled ?? false;

  const handleClick = async () => {
    if (isLoading || isDisabled) return;

    setInternalLoading(true);
    try {
      const result = await onClick();
      if (result && result.remaining !== null && result.limit !== null) {
        setRateInfo({ remaining: result.remaining, limit: result.limit, timestamp: Date.now() });
      }
    } finally {
      setInternalLoading(false);
    }
  };

  const isRateLimited = rateInfo !== null && rateInfo.remaining <= 0;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isLoading || isDisabled || isRateLimited}
        className={clsx(
          "inline-flex items-center gap-1.5 font-semibold rounded-lg transition-all duration-200",
          "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500",
          "text-white shadow-md hover:shadow-lg active:scale-95",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:shadow-md",
          "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900",
          size === "normal" && "px-4 py-2 text-sm",
          size === "small" && "px-2.5 py-1 text-xs",
          isLoading && "animate-pulse",
          className,
        )}
        title={isRateLimited ? `Rate limit exceeded (${rateInfo.limit}/${rateInfo.limit}). Please wait.` : undefined}
      >
        {isLoading ? (
          <span className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <svg className={size === "normal" ? "w-4 h-4" : "w-3 h-3"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}
        {children}
      </button>

      {/* Rate limit status badge */}
      {rateInfo && !isLoading && (
        <span
          className={clsx(
            "text-[10px] leading-tight px-1.5 py-0.5 rounded",
            isRateLimited
              ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
              : rateInfo.remaining <= 2
                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
          )}
        >
          {isRateLimited
            ? "Rate limit reached — wait 1 min"
            : `${rateInfo.remaining}/${rateInfo.limit} AI calls left`}
        </span>
      )}
    </div>
  );
}
