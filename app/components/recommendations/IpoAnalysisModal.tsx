"use client";

// app/components/recommendations/IpoAnalysisModal.tsx
//
// Popup shown after clicking "AI Analysis" on an Open-Now IPO row. Caches:
// a second click on the same symbol (by any user) serves the SAME 12h-cached
// result instantly — the API layer dedupes model calls, this component just
// re-renders what came back.

import { useState, useEffect } from "react";
import Link from "next/link";
import IpoReportView from "./IpoReportView";
import type { IpoReport } from "@/lib/services/ipoReport";

interface ModalProps {
  symbol: string;
  companyName: string;
  open: boolean;
  onClose: () => void;
}

interface IpoAnalysisPayload {
  recommendation: string;
  verdict: string;
  content: string;
  generatedAt: string;
  report?: IpoReport | null;
}

type ModalState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; analysis: IpoAnalysisPayload; source: string };

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^[-*•]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function recBadge(rec: string): { label: string; cls: string } {
  const upper = rec.toUpperCase();
  if (upper.includes("SELL 100%"))
    return { label: "Sell 100% on Listing Day", cls: "bg-red-500/15 text-red-300 border-red-500/40" };
  if (upper.includes("SELL 50%"))
    return { label: "Sell 50% / Hold 50%", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" };
  if (upper.includes("STRONG LONG-TERM"))
    return { label: "Strong Long-Term Hold", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" };
  if (upper.includes("HOLD FOR 1-3"))
    return { label: "Hold 1–3 Years", cls: "bg-blue-500/15 text-blue-300 border-blue-500/40" };
  return { label: rec, cls: "bg-gray-500/15 text-gray-300 border-gray-600/40" };
}

export default function IpoAnalysisModal({ symbol, companyName, open, onClose }: ModalProps) {
  const [state, setState] = useState<ModalState>({ phase: "loading" });

  // Fetch analysis whenever the modal opens (cache-first server side).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ phase: "loading" });

    const load = async () => {
      try {
        const res = await fetch(`/api/recommendations/ipos/${symbol}/analysis`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setState({ phase: "error", message: data.error || "Analysis failed. Please try again." });
          return;
        }
        setState({ phase: "done", analysis: data.analysis, source: data.source });
      } catch {
        if (!cancelled) setState({ phase: "error", message: "Could not reach the analysis service." });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, symbol]);

  if (!open) return null;

  const retry = () => {
    setState({ phase: "loading" });
    fetch(`/api/recommendations/ipos/${symbol}/analysis?refresh=1`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          setState({ phase: "error", message: data.error || "Analysis failed." });
          return;
        }
        setState({ phase: "done", analysis: data.analysis, source: data.source });
      })
      .catch(() => setState({ phase: "error", message: "Could not reach the analysis service." }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`AI analysis for ${companyName}`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-800">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-100">🤖 AI Analysis — {companyName}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {symbol} · 14-step equity research brief · result cached 12h
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.phase === "loading" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-gray-400">
                <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Generating 14-step analysis for {symbol} — this can take 30–60 seconds…
              </div>
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-3 bg-gray-800 rounded w-full" />
                ))}
              </div>
            </div>
          ) : state.phase === "error" ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
              <p className="text-sm text-red-300">{state.message}</p>
              <button
                onClick={retry}
                className="mt-3 px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded text-xs text-red-300 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {state.analysis.report ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const b = recBadge(state.analysis.report!.verdict.label);
                      return (
                        <span className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${b.cls}`}>
                          {b.label}
                        </span>
                      );
                    })()}
                    {state.source === "cache" && (
                      <span className="px-2 py-1 rounded-md text-xs font-medium bg-blue-500/15 border border-blue-500/40 text-blue-300">
                        Cached result
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {new Date(state.analysis.generatedAt).toLocaleString("en-IN")}
                    </span>
                  </div>
                  <IpoReportView report={state.analysis.report} />
                </>
              ) : (
                <>
                  {state.analysis.recommendation && (
                    <div className="flex flex-wrap items-center gap-2">
                      {(() => {
                        const b = recBadge(state.analysis.recommendation);
                        return (
                          <span className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${b.cls}`}>
                            {b.label}
                          </span>
                        );
                      })()}
                      {state.source === "cache" && (
                        <span className="px-2 py-1 rounded-md text-xs font-medium bg-blue-500/15 border border-blue-500/40 text-blue-300">
                          Cached result
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        {new Date(state.analysis.generatedAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                  )}

                  {state.analysis.verdict && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
                      <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold mb-1.5">
                        Investment Verdict
                      </div>
                      <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                        {state.analysis.verdict}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {stripMarkdown(state.analysis.content)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800">
          <span className="text-xs text-gray-500">
            {state.phase === "done" && state.source === "ai"
              ? "Freshly generated — now cached for 12h"
              : "Shared cache — no duplicate AI calls"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
            >
              Close
            </button>
            <Link
              href={`/recommendations/ipos/${symbol}`}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium text-white transition-colors"
            >
              Full Analysis →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}