"use client";

import { useState, useEffect } from "react";
import type { TradingIdea } from "@/lib/services/tradingviewIdeasService";

interface IdeasTabProps {
  loading?: boolean;
}

interface IdeasApiResult {
  success: boolean;
  ideas?: TradingIdea[];
  source?: "cache" | "api" | "db";
  syncedAt?: string | null;
}

function sourceLabel(source: string | undefined): string {
  switch (source) {
    case "api":
      return "Live from TradingView";
    case "cache":
      return "Cached";
    case "db":
      return "Cached (offline)";
    default:
      return "";
  }
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const diffMs = Date.now() - timestamp * 1000;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function IdeasTab({ loading = false }: IdeasTabProps) {
  const [ideas, setIdeas] = useState<TradingIdea[]>([]);
  const [error, setError] = useState("");
  const [source, setSource] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);

  const fetchIdeas = async (force = false) => {
    try {
      if (!force) setError("");
      const res = await fetch(
        force ? "/api/recommendations/ideas?refresh=1" : "/api/recommendations/ideas"
      );
      const data: IdeasApiResult = await res.json();
      if (data.success) {
        setIdeas(data.ideas || []);
        setSource(data.source || "");
      } else {
        setError("Failed to load trading ideas");
      }
    } catch (e) {
      setError("Failed to load trading ideas");
    }
  };

  useEffect(() => {
    fetchIdeas();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchIdeas(true);
    setRefreshing(false);
  };

  return (
    <div className="space-y-4">
      {/* Tutorial banner */}
      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <span className="text-xl">💡</span>
        <div>
          <p className="text-sm font-medium text-blue-300">Community trading ideas — NSE</p>
          <p className="text-xs text-gray-400 mt-1">
            Curated from TradingView India. Tap a card to open the full idea and chart on TradingView.
          </p>
        </div>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-200">
          Latest Ideas{" "}
          {ideas.length > 0 && (
            <span className="text-sm text-gray-500 font-normal">({ideas.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {source && (
            <span className="text-xs text-gray-500">{sourceLabel(source)}</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {loading && ideas.length === 0 ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
              <div className="h-4 bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-700 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : error && ideas.length === 0 ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => fetchIdeas()}
            className="mt-3 px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded text-xs text-red-300 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : ideas.length === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-400">No trading ideas available right now.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {ideas.map((idea) => (
            <a
              key={idea.id}
              href={idea.chartUrl || `https://in.tradingview.com/chart/?symbol=${idea.symbolFullName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 hover:border-blue-500/40 hover:bg-gray-800 transition-colors block"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-gray-200 font-medium">
                    {idea.symbolShortName || idea.symbolFullName}
                    <span className="ml-2 text-xs text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      {idea.exchange}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{idea.username}</div>
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {relativeTime(idea.dateTimestamp)}
                </span>
              </div>

              <p className="text-sm text-gray-300 mt-2 line-clamp-2">{idea.name}</p>
              {idea.description && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{idea.description}</p>
              )}

              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                <span>👍 {idea.likesCount}</span>
                <span>💬 {idea.commentsCount}</span>
                <span>👁 {idea.viewsCount}</span>
                {idea.isHot && (
                  <span className="text-amber-400 border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    🔥 Hot
                  </span>
                )}
                {idea.isPicked && (
                  <span className="text-blue-400 border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 rounded">
                    ⭐ Picked
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}