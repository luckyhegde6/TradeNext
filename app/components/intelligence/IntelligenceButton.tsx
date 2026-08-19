"use client";

import { useState } from "react";

type ButtonState = "unauthenticated" | "idle" | "loading" | "ready" | "failed";

interface IntelligenceButtonProps {
  state: ButtonState;
  onGenerate?: () => void;
  onToggle?: () => void;
  isOpen?: boolean;
}

const STATE_CONFIG: Record<ButtonState, { label: string; className: string; icon: string; disabled: boolean }> = {
  unauthenticated: {
    label: "Sign in for AI Analysis",
    className: "bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-400 cursor-not-allowed",
    icon: "🔒",
    disabled: true,
  },
  idle: {
    label: "AI Analysis",
    className: "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer",
    icon: "✨",
    disabled: false,
  },
  loading: {
    label: "Analyzing...",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 cursor-wait animate-pulse",
    icon: "⏳",
    disabled: true,
  },
  ready: {
    label: "AI Analysis ✓",
    className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 cursor-pointer",
    icon: "📊",
    disabled: false,
  },
  failed: {
    label: "Analysis unavailable",
    className: "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60 cursor-pointer",
    icon: "⚠️",
    disabled: false,
  },
};

export default function IntelligenceButton({ state, onGenerate, onToggle, isOpen }: IntelligenceButtonProps) {
  const config = STATE_CONFIG[state];

  const handleClick = () => {
    if (config.disabled) return;
    if (state === "ready" && onToggle) {
      onToggle();
    } else if ((state === "idle" || state === "failed") && onGenerate) {
      onGenerate();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={config.disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${config.className}`}
      data-testid="intelligence-button"
      aria-label={config.label}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
      {state === "ready" && isOpen && <span className="text-xs">▲</span>}
      {state === "ready" && !isOpen && <span className="text-xs">▼</span>}
    </button>
  );
}
