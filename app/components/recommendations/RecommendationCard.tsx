"use client";

import { useState } from "react";
import Link from "next/link";

interface RecommendationCardProps {
  symbol: string;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  volume?: number | null;
  aiRecommendation?: string | null; // BUY | HOLD | SELL
  confidence?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  timeHorizon?: string | null;
  reasoning?: string | null;
  riskFactors?: string[] | null;
  screenerAttribution?: string[] | null;
  screenerCount?: number | null;
}

export default function RecommendationCard({
  symbol,
  price = 0,
  change = 0,
  changePercent = 0,
  volume = 0,
  aiRecommendation = "HOLD",
  confidence = 0,
  targetPrice = null,
  stopLoss = null,
  timeHorizon = "medium",
  reasoning = "",
  riskFactors = [],
  screenerAttribution = [],
  screenerCount = 0,
}: RecommendationCardProps) {
  const [expanded, setExpanded] = useState(false);
  
  // Safe numeric values
  const safePrice = Number(price) || 0;
  const safeChange = Number(change) || 0;
  const safeChangePercent = Number(changePercent) || 0;
  const safeVolume = Number(volume) || 0;
  const safeConfidence = Number(confidence) || 0;
  const safeScreenerCount = Number(screenerCount) || 0;
  const safeRiskFactors = Array.isArray(riskFactors) ? riskFactors : [];
  const safeAttribution = Array.isArray(screenerAttribution) ? screenerAttribution : [];

  // Color coding
  const recColor = aiRecommendation === "BUY" ? "text-emerald-400" : aiRecommendation === "SELL" ? "text-red-400" : "text-amber-400";
  const recBg = aiRecommendation === "BUY" ? "bg-emerald-500/10 border-emerald-500/30" : aiRecommendation === "SELL" ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30";
  const changeColor = safeChange >= 0 ? "text-emerald-400" : "text-red-400";
  const horizonColors: Record<string, string> = { short: "bg-blue-500/20 text-blue-300", medium: "bg-purple-500/20 text-purple-300", long: "bg-indigo-500/20 text-indigo-300" };
  
  // Format volume
  const formatVolume = (v: number) => {
    if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
    return v.toLocaleString("en-IN");
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600/50 transition-all">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <Link href={`/company/${symbol}`} className="text-lg font-bold text-white hover:text-blue-400 transition-colors">
            {symbol}
          </Link>
          <div className="text-sm text-gray-400 mt-0.5">NSE</div>
        </div>
        <div className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${recBg} ${recColor}`}>
          {aiRecommendation}
        </div>
      </div>

      {/* Price & Change */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl font-bold text-white">₹{safePrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span className={`text-sm font-medium ${changeColor}`}>
          {safeChange >= 0 ? "+" : ""}{safeChange.toFixed(2)} ({safeChangePercent >= 0 ? "+" : ""}{safeChangePercent.toFixed(2)}%)
        </span>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div className="bg-gray-900/50 rounded-lg p-2 text-center">
          <div className="text-gray-500">Confidence</div>
          <div className="font-bold text-white">{safeConfidence}%</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-2 text-center">
          <div className="text-gray-500">Target</div>
          <div className="font-bold text-emerald-400">
            {targetPrice != null ? `₹${Number(targetPrice).toLocaleString("en-IN")}` : "—"}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-2 text-center">
          <div className="text-gray-500">Stop Loss</div>
          <div className="font-bold text-red-400">
            {stopLoss != null ? `₹${Number(stopLoss).toLocaleString("en-IN")}` : "—"}
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className={`px-2 py-0.5 rounded-full text-xs ${horizonColors[timeHorizon || "medium"] || "bg-gray-500/20 text-gray-300"}`}>
          {timeHorizon || "medium"} term
        </span>
        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-500/20 text-gray-300">
          Vol: {formatVolume(safeVolume)}
        </span>
        {safeScreenerCount > 1 && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-cyan-500/20 text-cyan-300">
            {safeScreenerCount} screeners
          </span>
        )}
      </div>

      {/* Screener Attribution */}
      {safeAttribution.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {safeAttribution.map((name, i) => (
            <span key={i} className="px-2 py-0.5 rounded text-xs bg-gray-700/50 text-gray-400">
              {name}
            </span>
          ))}
        </div>
      )}

      {/* Expandable AI Analysis */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left text-xs text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-1"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>AI Analysis</span>
      </button>
      
      {expanded && (
        <div className="mt-2 p-3 bg-gray-900/50 rounded-lg text-sm">
          <p className="text-gray-300 mb-2">{reasoning || "No analysis available yet."}</p>
          {safeRiskFactors.length > 0 && (
            <div>
              <span className="text-xs text-red-400 font-medium">Risks:</span>
              <ul className="mt-1 space-y-0.5">
                {safeRiskFactors.map((risk, i) => (
                  <li key={i} className="text-xs text-gray-400">• {risk}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
