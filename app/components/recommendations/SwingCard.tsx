"use client";

import { useState } from "react";
import Link from "next/link";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { classifyStock, getCategoryMeta } from "@/lib/services/marketCapClassification";
import { openNSEChart } from "@/lib/charting";
import type { SignalFamily, SwingStock } from "@/lib/services/swing-types";

const FAMILY_META: Record<SignalFamily, { label: string; classes: string }> = {
  trend: { label: "Trend", classes: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  breakout: { label: "Breakout", classes: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  reversal: { label: "Reversal", classes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  momentum: { label: "Momentum", classes: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  volume: { label: "Volume", classes: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  range: { label: "Range", classes: "bg-pink-500/15 text-pink-300 border-pink-500/30" },
};

const ACTION_META = {
  LONG: { label: "▲ LONG", classes: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
  SHORT: { label: "▼ SHORT", classes: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  OBSERVE: { label: "◍ OBSERVE", classes: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
} as const;

const SOURCE_LABEL: Record<string, string> = {
  chartink_db: "Captured scan",
  chartink_live: "Live Chartink",
  tradingview: "TV fallback",
};

function fmtVolume(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

function fmtPct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default function SwingCard({ stock }: { stock: SwingStock }) {
  const [showAllTags, setShowAllTags] = useState(false);
  const [showLogic, setShowLogic] = useState(false);

  const catMeta = getCategoryMeta(classifyStock(stock.symbol));
  const up = stock.changePercent >= 0;
  const analysis = stock.analysis;
  const visibleTags = showAllTags ? stock.screenerNames : stock.screenerNames.slice(0, 3);

  const targetReturn = analysis
    ? ((analysis.targetPrice - analysis.entryPrice) / analysis.entryPrice) * 100
    : null;

  return (
    <div className="relative bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 hover:border-gray-600 transition-all">
      {/* Category badge */}
      <div
        className={`absolute -top-2 -right-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold border ${catMeta.bgColor} ${catMeta.textColor} ${catMeta.borderColor}`}
      >
        {catMeta.label}
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <Link
            href={`/company/${stock.symbol}`}
            className="text-sm font-bold text-white hover:text-blue-400 truncate block"
          >
            {stock.symbol}
          </Link>
          <p className="text-xs text-gray-500 truncate">{stock.name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => openNSEChart(stock.symbol)}
            aria-label={`Open ${stock.symbol} candlestick chart on NSE`}
            title="Candlestick chart on NSE"
            className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChartBarIcon className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {SOURCE_LABEL[stock.source] ?? stock.source}
          </span>
        </div>
      </div>

      {/* ── Price row ─────────────────────────────────────────── */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-lg font-bold text-white">₹{stock.price.toFixed(2)}</span>
        <span className={`text-xs font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>
          {up ? "+" : ""}
          {stock.changePercent.toFixed(2)}%
        </span>
        <span className="text-xs text-gray-500 ml-auto">Vol {fmtVolume(stock.volume)}</span>
      </div>

      {/* ── Signal families ───────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 mb-2">
        {stock.families.map((f) => (
          <span
            key={f}
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${FAMILY_META[f].classes}`}
          >
            {FAMILY_META[f].label}
          </span>
        ))}
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-700/40 text-gray-300 border border-gray-600">
          {stock.screenerCount} screener{stock.screenerCount === 1 ? "" : "s"}
        </span>
      </div>

      {/* ── Screener tags ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 mb-3">
        {visibleTags.map((tag) => (
          <span
            key={tag}
            className="px-1.5 py-0.5 rounded bg-gray-900/60 border border-gray-700 text-[10px] text-gray-300"
          >
            {tag}
          </span>
        ))}
        {stock.screenerNames.length > 3 && (
          <button
            onClick={() => setShowAllTags((v) => !v)}
            className="text-[10px] text-blue-400 hover:text-blue-300 underline"
          >
            {showAllTags ? "fewer ▲" : `+${stock.screenerNames.length - 3} more ▼`}
          </button>
        )}
      </div>

      {/* ── Indicators ────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-1 mb-3 text-center">
        {[
          { label: "20d Mom", value: fmtPct(stock.indicators.momentum20) },
          { label: "10d Mom", value: fmtPct(stock.indicators.momentum10) },
          { label: "20d Vol", value: stock.indicators.volatility20 != null ? `${stock.indicators.volatility20.toFixed(1)}%` : "—" },
          { label: "vs 20d High", value: fmtPct(stock.indicators.distanceFrom20dHigh) },
        ].map((i) => (
          <div key={i.label} className="bg-gray-900/50 rounded px-1 py-1">
            <div className="text-[9px] text-gray-500 uppercase">{i.label}</div>
            <div className="text-[11px] font-semibold text-gray-200">{i.value}</div>
          </div>
        ))}
      </div>

      {/* ── AI analysis ───────────────────────────────────────── */}
      {analysis ? (
        <div className="border-t border-gray-700/50 pt-2">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${ACTION_META[analysis.action].classes}`}
            >
              {ACTION_META[analysis.action].label}
            </span>
            <span className="text-xs text-gray-400">Conf {analysis.confidence}%</span>
            <span className="text-xs text-gray-500 ml-auto">Mom {analysis.momentumScore}/100</span>
          </div>

          {/* Confidence bar */}
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-2">
            <div
              className={`h-full ${analysis.action === "LONG" ? "bg-emerald-500" : analysis.action === "SHORT" ? "bg-rose-500" : "bg-amber-500"}`}
              style={{ width: `${analysis.confidence}%` }}
            />
          </div>

          {/* Entry / Target / Stop */}
          <div className="grid grid-cols-3 gap-1 mb-2 text-center">
            <div className="bg-gray-900/50 rounded px-1 py-1">
              <div className="text-[9px] text-gray-500 uppercase">Entry</div>
              <div className="text-[11px] font-semibold text-gray-200">₹{analysis.entryPrice.toFixed(2)}</div>
            </div>
            <div className="bg-gray-900/50 rounded px-1 py-1">
              <div className="text-[9px] text-gray-500 uppercase">Target</div>
              <div className="text-[11px] font-semibold text-emerald-300">
                ₹{analysis.targetPrice.toFixed(2)}
                {targetReturn !== null && (
                  <span className="text-[9px] text-emerald-400"> ({targetReturn >= 0 ? "+" : ""}{targetReturn.toFixed(0)}%)</span>
                )}
              </div>
            </div>
            <div className="bg-gray-900/50 rounded px-1 py-1">
              <div className="text-[9px] text-gray-500 uppercase">Stop</div>
              <div className="text-[11px] font-semibold text-rose-300">₹{analysis.stopLoss.toFixed(2)}</div>
            </div>
          </div>

          <div className="text-[10px] text-gray-500 mb-1">
            Horizon: <span className="text-gray-400 capitalize">{analysis.timeHorizon}</span>
          </div>

          <button
            onClick={() => setShowLogic((v) => !v)}
            className="text-[11px] text-blue-400 hover:text-blue-300 underline"
          >
            {showLogic ? "Hide logic ▲" : "Show logic ▼"}
          </button>
          {showLogic && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-300 leading-relaxed">{analysis.logic}</p>
              {analysis.riskFactors.length > 0 && (
                <ul className="list-disc list-inside text-[11px] text-amber-300/90 space-y-0.5">
                  {analysis.riskFactors.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-gray-700/50 pt-2">
          <p className="text-[11px] text-gray-500">
            {stock.analysisError
              ? `AI targets unavailable (${stock.analysisError.slice(0, 60)}) — screener signals only`
              : "AI analysis pending — screener signals only"}
          </p>
        </div>
      )}
    </div>
  );
}
