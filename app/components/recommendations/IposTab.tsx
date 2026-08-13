"use client";

import { useState, useEffect, Fragment } from "react";
import type { IpoIssue } from "@/lib/services/nseIpoService";
import { formatIssueSize } from "@/lib/services/ipoIssueSize";
import IpoAnalysisModal from "./IpoAnalysisModal";

interface IposTabProps {
  loading?: boolean;
}

interface IpoApiResult {
  success: boolean;
  issues?: IpoIssue[];
  source?: "cache" | "api" | "db";
  syncedAt?: string | null;
}

interface DetailApiResult {
  success: boolean;
  detail?: {
    bidLot: string;
    sharesPerLot: number | null;
    issueSizeText: string;
    priceRange: string;
  } | null;
}

const STATUS_SECTIONS = [
  { status: "Active", key: "current", label: "Current IPOs", emoji: "🟢", subtitle: "Open for subscription" },
  { status: "Forthcoming", key: "upcoming", label: "Upcoming IPOs", emoji: "🕐", subtitle: "Opens soon" },
  { status: "Closed", key: "closed", label: "Recently Closed", emoji: "⚪", subtitle: "Subscription ended" },
] as const;

// Status pill styles — Active (current) gets a strong emerald "Open Now" label.
function StatusPill({ status }: { status: string }) {
  if (status === "Active") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Open Now
      </span>
    );
  }
  if (status === "Forthcoming") {
    return (
      <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-500/15 border border-amber-500/40 text-amber-300">
        Upcoming
      </span>
    );
  }
  return (
    <span className="px-2 py-1 rounded-md text-xs font-medium bg-gray-500/15 border border-gray-600/40 text-gray-400">
      Closed
    </span>
  );
}

// Row highlight for current (Active) listings.
function rowClass(status: string): string {
  return status === "Active"
    ? "bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12]"
    : "hover:bg-gray-800/40";
}

function sourceLabel(source: string | undefined): string {
  switch (source) {
    case "api":
      return "Live from NSE";
    case "cache":
      return "Cached";
    case "db":
      return "Cached (offline)";
    default:
      return "";
  }
}

export default function IposTab({ loading = false }: IposTabProps) {
  const [issues, setIssues] = useState<IpoIssue[]>([]);
  const [error, setError] = useState("");
  const [source, setSource] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  // Active (Open Now) IPO whose AI analysis modal is currently open.
  const [analysisTarget, setAnalysisTarget] = useState<IpoIssue | null>(null);
  // Per-symbol parsed IPO detail (Bid Lot → shares per lot) for Issue Size display.
  const [details, setDetails] = useState<Record<string, DetailApiResult["detail"]>>({});

  const fetchIpos = async (force = false) => {
    try {
      if (!force) setError("");
      const res = await fetch(
        force ? "/api/recommendations/ipos?refresh=1" : "/api/recommendations/ipos"
      );
      const data: IpoApiResult = await res.json();
      if (data.success) {
        setIssues(data.issues || []);
        setSource(data.source || "");
      } else {
        setError("Failed to load IPO issues");
      }
    } catch (e) {
      setError("Failed to load IPO issues");
    }
  };

  useEffect(() => {
    fetchIpos();
  }, []);

  // Lightweight per-symbol detail fetch (24h-cached server-side). Only the
  // displayed issue set is requested, batched; failures fall back to the raw
  // issueSize string. Never blocks the main table render.
  useEffect(() => {
    if (issues.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, DetailApiResult["detail"]> = {};
      await Promise.all(
        issues.map(async (issue) => {
          try {
            const res = await fetch(`/api/recommendations/ipos/${issue.symbol}/detail`);
            const data: DetailApiResult = await res.json();
            if (data.success && data.detail) {
              map[issue.symbol.toUpperCase()] = data.detail;
            }
          } catch {
            // ignore — fall back to issue.issueSize
          }
        })
      );
      if (!cancelled) setDetails(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [issues]);

  function issueSizeCell(issue: IpoIssue): string {
    const detail = details[issue.symbol.toUpperCase()];
    if (detail) {
      const formatted = formatIssueSize(detail);
      if (formatted) return formatted;
    }
    return issue.issueSize;
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchIpos(true);
    setRefreshing(false);
  };

  const currentCount = issues.filter((i) => i.status === "Active").length;
  const upcomingCount = issues.filter((i) => i.status === "Forthcoming").length;
  const closedCount = issues.filter((i) => i.status === "Closed").length;
  const hasSections = currentCount > 0 || upcomingCount > 0 || closedCount > 0;

  return (
    <div className="space-y-4">
      {/* Coming soon banner (alerts only — the tracking table is live) */}
      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <span className="text-xl">🚀</span>
        <div>
          <p className="text-sm font-medium text-blue-300">IPO alerts coming soon</p>
          <p className="text-xs text-gray-400 mt-1">
            Subscribe to alerts for new IPO openings, allotment results, and listing-day performance. Stay tuned!
          </p>
        </div>
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-200">
          IPO Issues{" "}
          {issues.length > 0 && (
            <span className="text-sm text-gray-500 font-normal">({issues.length})</span>
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

      {loading && issues.length === 0 ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
              <div className="h-4 bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : error && issues.length === 0 ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => fetchIpos()}
            className="mt-3 px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded text-xs text-red-300 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : issues.length === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-400">No IPO issues at the moment.</p>
        </div>
      ) : !hasSections ? (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-400">No IPO issues listed right now.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-800/80 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Series</th>
                <th className="px-4 py-3">Open</th>
                <th className="px-4 py-3">Close</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Issue Size</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_SECTIONS.map((section) => {
                const sectionIssues = issues.filter((i) => i.status === section.status);
                if (sectionIssues.length === 0) return null;
                return (
                  <Fragment key={section.key}>
                    {/* Section divider */}
                    <tr className="bg-gray-900/60 border-t border-gray-800">
                      <td colSpan={8} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span>{section.emoji}</span>
                          <span className="text-xs font-semibold uppercase tracking-wider">
                            {section.label}
                            <span className="ml-2 text-gray-500 font-normal normal-case">
                              {sectionIssues.length}
                              {section.subtitle ? ` · ${section.subtitle}` : ""}
                            </span>
                          </span>
                        </div>
                      </td>
                    </tr>
                    {sectionIssues.map((issue, idx) => (
                      <tr
                        key={`${issue.symbol}-${idx}`}
                        className={`border-t border-gray-800 transition-colors ${rowClass(issue.status)}`}
                      >
                        <td className="px-4 py-3">
                          <div className="text-gray-200 font-medium">
                            <a
                              href={`/recommendations/ipos/${issue.symbol}`}
                              className="hover:text-blue-400 transition-colors"
                            >
                              {issue.companyName}
                            </a>
                          </div>
                          <div className="text-xs text-gray-500">{issue.symbol}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{issue.series}</td>
                        <td className="px-4 py-3 text-gray-300">{issue.issueStartDate}</td>
                        <td className="px-4 py-3 text-gray-500">{issue.issueEndDate}</td>
                        <td className="px-4 py-3 text-gray-300">{issue.issuePrice}</td>
                        <td className="px-4 py-3 text-gray-400">{issueSizeCell(issue)}</td>
                        <td className="px-4 py-3">
                          <StatusPill status={issue.status} />
                        </td>
                        <td className="px-4 py-3">
                          {issue.status === "Active" && (
                            <button
                              onClick={() => setAnalysisTarget(issue)}
                              className="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-lg text-xs font-medium text-emerald-300 transition-colors"
                            >
                              🤖 AI Analysis
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Analysis modal — only for Active (Open Now) rows */}
      {analysisTarget && (
        <IpoAnalysisModal
          symbol={analysisTarget.symbol}
          companyName={analysisTarget.companyName}
          open={!!analysisTarget}
          onClose={() => setAnalysisTarget(null)}
        />
      )}
    </div>
  );
}