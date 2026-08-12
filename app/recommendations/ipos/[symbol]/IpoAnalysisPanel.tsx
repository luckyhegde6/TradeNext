"use client";

// app/recommendations/ipos/[symbol]/IpoAnalysisPanel.tsx
//
// Client panel for the dynamic IPO landing page. If no analysis exists yet,
// the user clicks "Run AI Analysis" → POST/GET generates it (auth-gated API);
// cached results (12h) are served instantly on later visits. Renders the
// 14-step analysis with a light markdown formatting (bold/headings/bullets)
// and an "Investment Verdict" callout.

import { useState } from "react";
import IpoReportView from "@/app/components/recommendations/IpoReportView";
import type { IpoReport } from "@/lib/services/ipoReport";

interface CachedAnalysis {
  companyName: string;
  content: string;
  verdict: string;
  recommendation: string;
  generatedAt: string;
  report?: IpoReport | null;
}

interface IpoAnalysisPanelProps {
  symbol: string;
  companyName: string;
  signedIn: boolean;
  cachedAnalysis?: CachedAnalysis | null;
  cachedSource?: string | null;
}

type PanelState =
  | { phase: "idle" } // nothing yet, user not signed in or hasn't clicked
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; analysis: CachedAnalysis; source: string };

/** Lightweight markdown renderer: **bold**, ### headings, "- " bullets, \n paragraphs. */
function renderAnalysis(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length > 0) {
      nodes.push(
        <ul key={`ul-${key++}`} className="space-y-1 my-2">
          {list}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    const isBullet = /^[-*•]\s+/.test(line);
    const isHeading = /^#{1,4}\s+/.test(line);

    if (isHeading) {
      flushList();
      const text = line.replace(/^#{1,4}\s+/, "");
      nodes.push(
        <h4 key={`h-${key++}`} className="text-sm font-semibold text-gray-200 mt-4 mb-1">
          {text}
        </h4>
      );
      continue;
    }

    if (isBullet) {
      const content = line.replace(/^[-*•]\s+/, "");
      list.push(
        <li key={`li-${key++}`} className="text-sm text-gray-300 ml-1 flex gap-1.5">
          <span className="text-blue-400 select-none">•</span>
          <span>{inlineFormat(content, key)}</span>
        </li>
      );
      continue;
    }

    flushList();
    nodes.push(
      <p key={`p-${key++}`} className="text-sm text-gray-300 leading-relaxed my-1.5">
        {inlineFormat(line, key)}
      </p>
    );
  }
  flushList();
  return nodes;
}

/** Bold **x** + inline segments. */
function inlineFormat(text: string, keyBase: number): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyBase}-b-${i}`} className="text-gray-100 font-semibold">
        {part}
      </strong>
    ) : (
      <span key={`${keyBase}-s-${i}`}>{part}</span>
    )
  );
}

function recommendationBadge(rec: string): { label: string; cls: string } {
  const upper = rec.toUpperCase();
  if (upper.includes("SELL 100%"))
    return { label: "Sell 100% on Listing Day", cls: "bg-red-500/15 text-red-300 border-red-500/40" };
  if (upper.includes("SELL 50%"))
    return { label: "Sell 50% / Hold 50%", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" };
  if (upper.includes("STRONG LONG-TERM"))
    return { label: "Strong Long-Term Hold", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" };
  if (upper.includes("HOLD FOR 1-3"))
    return { label: "Hold 1–3 Years", cls: "bg-blue-500/15 text-blue-300 border-blue-500/40" };
  return { label: rec || "", cls: "bg-gray-500/15 text-gray-300 border-gray-600/40" };
}

export default function IpoAnalysisPanel({
  symbol,
  companyName,
  signedIn,
  cachedAnalysis,
  cachedSource,
}: IpoAnalysisPanelProps) {
  const [state, setState] = useState<PanelState>(
    cachedAnalysis
      ? { phase: "done", analysis: cachedAnalysis, source: cachedSource || "cache" }
      : { phase: "idle" }
  );

  const runAnalysis = async (force = false) => {
    if (!signedIn) return;
    setState({ phase: "loading" });
    try {
      const res = await fetch(
        force
          ? `/api/recommendations/ipos/${symbol}/analysis?refresh=1`
          : `/api/recommendations/ipos/${symbol}/analysis`
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setState({ phase: "error", message: data.error || "Analysis failed. Please try again." });
        return;
      }
      setState({ phase: "done", analysis: data.analysis, source: data.source });
    } catch {
      setState({ phase: "error", message: "Could not reach the analysis service." });
    }
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-gray-100">🤖 AI IPO Analysis</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            14-step equity research brief · cached 12h (shared across users)
          </p>
        </div>
        {signedIn ? (
          <div className="flex items-center gap-2">
            {state.phase === "done" && (
              <button
                onClick={() => runAnalysis(true)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
              >
                ↻ Re-analyze
              </button>
            )}
            {state.phase !== "loading" && state.phase !== "done" && (
              <button
                onClick={() => runAnalysis(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors"
              >
                ✍ Run AI Analysis
              </button>
            )}
          </div>
        ) : (
          <a
            href="/auth/signin"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium text-white transition-colors"
          >
            Sign in to analyze
          </a>
        )}
      </div>

      {/* Body */}
      {!signedIn && state.phase === "idle" ? (
        <div className="text-sm text-gray-400 border border-gray-800 bg-gray-900/20 rounded-lg p-6 text-center">
          Sign in to run the 14-step AI analysis for {companyName}.
        </div>
      ) : state.phase === "loading" ? (
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
            onClick={() => runAnalysis(false)}
            className="mt-3 px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded text-xs text-red-300 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : state.phase === "done" ? (
        state.analysis.report ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const b = recommendationBadge(state.analysis.report!.verdict.label);
                return (
                  <span className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${b.cls}`}>
                    {b.label}
                  </span>
                );
              })()}
              <span className="text-xs text-gray-500">
                Generated {new Date(state.analysis.generatedAt).toLocaleString("en-IN")}
              </span>
            </div>
            <IpoReportView report={state.analysis.report} />
          </div>
        ) : (
        <div className="space-y-4">
          {/* Recommendation badge */}
          {state.analysis.recommendation && (
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const b = recommendationBadge(state.analysis.recommendation);
                return (
                  <span
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${b.cls}`}
                  >
                    {b.label}
                  </span>
                );
              })()}
              <span className="text-xs text-gray-500">
                Generated {new Date(state.analysis.generatedAt).toLocaleString("en-IN")}
              </span>
            </div>
          )}

          {/* Investment Verdict callout */}
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

          {/* Full analysis */}
          <div className="max-h-[600px] overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            {renderAnalysis(state.analysis.content)}
          </div>
        </div>
        )
      ) : null}
    </section>
  );
}