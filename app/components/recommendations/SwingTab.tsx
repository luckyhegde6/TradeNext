"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import SwingCard from "./SwingCard";
import type { SignalFamily, SwingResponse } from "@/lib/services/swing-types";

const FAMILY_ORDER: SignalFamily[] = ["trend", "breakout", "reversal", "momentum", "volume", "range"];
const FAMILY_LABELS: Record<SignalFamily, string> = {
  trend: "Trend",
  breakout: "Breakout",
  reversal: "Reversal",
  momentum: "Momentum",
  volume: "Volume",
  range: "Range",
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ANALYSIS_STATUS_META: Record<SwingResponse["analysisStatus"], { label: string; classes: string }> = {
  done: { label: "AI targets ready", classes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  skipped: { label: "AI targets off", classes: "bg-gray-700/40 text-gray-400 border-gray-600" },
  failed: { label: "AI targets failed", classes: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

export default function SwingTab() {
  const [familyFilter, setFamilyFilter] = useState<SignalFamily | "all">("all");

  const { data, error, isLoading, isValidating, mutate } = useSWR<SwingResponse>(
    "/api/recommendations/swing",
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  const refresh = () => {
    mutate(
      fetch("/api/recommendations/swing?force=1").then((r) => r.json()),
      { revalidate: false },
    );
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    if (familyFilter === "all") return data.stocks;
    return data.stocks.filter((s) => s.families.includes(familyFilter));
  }, [data, familyFilter]);

  // ── Loading skeleton ───────────────────────────────────────────────
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-gray-800/50 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 bg-gray-800/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────
  if (error || (data && !data.success)) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 mb-4">Could not fetch swing signals.</p>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────
  if (!data || data.stocks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-3xl mb-3">🌊</p>
        <h3 className="text-white font-semibold mb-1">No swing signals right now</h3>
        <p className="text-gray-500 text-sm mb-4">
          Swing screeners run against live market data — check back after the next scan.
        </p>
        <button
          onClick={refresh}
          disabled={isValidating}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg border border-gray-700 disabled:opacity-50"
        >
          {isValidating ? "Scanning…" : "Run scan"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌊</span>
          <h2 className="text-white font-bold">Swing Trading Signals</h2>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ANALYSIS_STATUS_META[data.analysisStatus].classes}`}
        >
          {ANALYSIS_STATUS_META[data.analysisStatus].label}
        </span>
        <span className="text-xs text-gray-500 ml-auto">
          {data.topN} picks · {data.totalRaw} flagged · {data.templateCount} screeners
        </span>
        <button
          onClick={refresh}
          disabled={isValidating}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-lg border border-gray-700 disabled:opacity-50"
        >
          {isValidating ? "Refreshing…" : "⟳ Refresh"}
        </button>
      </div>

      {/* ── AI failure reason (honest, human-readable) ─────────────────── */}
      {data.analysisStatus === "failed" && data.analysisError && (
        <p
          className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
          title={data.analysisError}
        >
          ⚠️ AI targets failed — {data.analysisError.slice(0, 160)}
          {data.analysisError.length > 160 ? "…" : ""}
        </p>
      )}

      {/* ── Family segregation chips ──────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFamilyFilter("all")}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            familyFilter === "all"
              ? "bg-blue-600/20 text-blue-300 border-blue-500/40"
              : "bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-600"
          }`}
        >
          All ({data.stocks.length})
        </button>
        {FAMILY_ORDER.filter((f) => (data.segregation[f] ?? 0) > 0).map((f) => (
          <button
            key={f}
            onClick={() => setFamilyFilter(f)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              familyFilter === f
                ? "bg-blue-600/20 text-blue-300 border-blue-500/40"
                : "bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-600"
            }`}
          >
            {FAMILY_LABELS[f]} ({data.segregation[f] ?? 0})
          </button>
        ))}
      </div>

      {/* ── Cards grid ────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-500">
          No stocks in this signal family right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((stock) => (
            <SwingCard key={stock.symbol} stock={stock} />
          ))}
        </div>
      )}

      <p className="text-[10px] text-gray-600">
        Signal families are derived from the flagging screeners&apos; logic. AI targets are directional
        predictions — not investment advice. Generated {new Date(data.generatedAt).toLocaleString()}.
      </p>
    </div>
  );
}
