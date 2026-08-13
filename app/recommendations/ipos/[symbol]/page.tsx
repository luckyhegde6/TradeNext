// app/recommendations/ipos/[symbol]/page.tsx
//
// Dynamic IPO landing page — one per symbol. Shows the NSE issue card plus
// the 14-step AI analysis (auth-gated: logged-in users can run view/generate;
// everyone else sees a sign-in prompt). Analysis results are cached 12h and
// shared across users, so repeat visits reuse the same AI output.

import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getUpcomingIpoIssues,
  getIpoIssueDetail,
  formatIssueSize,
} from "@/lib/services/nseIpoService";
import {
  getIpoAnalysis,
  extractVerdict,
  extractRecommendation,
} from "@/lib/services/ipoAnalysisService";
import type { IpoReport } from "@/lib/services/ipoReport";
import IpoAnalysisPanel from "./IpoAnalysisPanel";

interface PageProps {
  params: Promise<{ symbol: string }>;
}

export default async function IpoLandingPage({ params }: PageProps) {
  const { symbol: symbolParam } = await params;
  const symbol = symbolParam.toUpperCase();

  // 1) Issue lookup from the (cheap, cached) IPO feed.
  const { data: issues } = await getUpcomingIpoIssues();
  const issue = issues.find((i) => i.symbol.toUpperCase() === symbol);
  if (!issue) notFound();

  // 1b) Per-issue detail (Bid Lot → shares per lot, Issue Size text) — 24h
  //     cached; best-effort so a detail failure never blocks the page.
  let issueSizeDisplay = issue.issueSize;
  try {
    const detailResult = await getIpoIssueDetail(symbol);
    const formatted = formatIssueSize(detailResult.data);
    if (formatted) issueSizeDisplay = formatted;
  } catch {
    // fall back to the raw list-payload issueSize
  }

  // 2) Auth state — controls whether the analysis can run on this page.
  const session = await auth();
  const userId = session?.user?.id || null;

  // 3) Best-effort pre-load of a cached analysis (never generates on the
  //    server render — generation is triggered by the client button so the
  //    page paints fast; a cached hit is served instantly).
  let cached: {
    companyName: string;
    content: string;
    verdict: string;
    recommendation: string;
    generatedAt: string;
    report?: IpoReport | null;
  } | null = null;
  let cachedSource: string | null = null;
  if (userId) {
    try {
      const result = await getIpoAnalysis(symbol);
      cached = {
        companyName: result.companyName,
        content: result.content,
        verdict: result.verdict,
        recommendation: result.recommendation,
        generatedAt: result.generatedAt,
        report: result.report ?? null,
      };
      cachedSource = result.source;
    } catch {
      cached = null; // no cached row yet — client button will generate
    }
  }

  const statusColor =
    issue.status === "Active"
      ? "emerald"
      : issue.status === "Forthcoming"
        ? "amber"
        : "gray";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 flex items-center gap-1.5">
        <Link href="/" className="hover:text-blue-400">Home</Link>
        <span>/</span>
        <Link href="/recommendations" className="hover:text-blue-400">Recommendations</Link>
        <span>/</span>
        <Link href="/recommendations#ipos" className="hover:text-blue-400">IPOs</Link>
        <span>/</span>
        <span className="text-gray-300">{symbol}</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">{issue.companyName}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {symbol} · {issue.series} ·{" "}
          <span
            className={
              statusColor === "emerald"
                ? "text-emerald-400"
                : statusColor === "amber"
                  ? "text-amber-400"
                  : "text-gray-400"
            }
          >
            {issue.status}
          </span>
        </p>
      </div>

      {/* Issue card */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        {[
          ["Open", issue.issueStartDate],
          ["Close", issue.issueEndDate],
          ["Price Band", issue.issuePrice || issue.priceBand],
          ["Issue Size", issueSizeDisplay],
          ["Lot Size", issue.lotSize || issueSizeDisplay || "—"],
          ["Series", issue.series],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
            <div className="text-sm text-gray-200 mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* AI Analysis */}
      <IpoAnalysisPanel
        symbol={symbol}
        companyName={issue.companyName}
        signedIn={Boolean(userId)}
        cachedAnalysis={cached}
        cachedSource={cachedSource}
      />
    </div>
  );
}