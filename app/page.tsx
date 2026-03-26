import Link from "next/link";
import { lazy, Suspense } from "react";
import MarqueeBanner from "@/app/components/MarqueeBanner";
import CorporateAnnouncementsWidget from "@/app/components/CorporateAnnouncementsWidget";
import IndexCorporateActions from "@/app/components/IndexCorporateActions";
import StockSearchBar from "@/app/components/StockSearchBar";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

// Lazy load chart component - it's heavy (~200KB with Chart.js)
const HomeChart = lazy(() => import("@/app/components/HomeChart"));

function ChartLoader() {
  return (
    <div className="h-[400px] flex items-center justify-center bg-gray-100 dark:bg-slate-800 rounded-xl">
      <div className="animate-pulse text-gray-400">Loading chart...</div>
    </div>
  );
}

// Allow dynamic rendering to ensure session is checked on every request
// This is critical for logout to work properly - users should see logged-out state immediately
export const dynamic = 'force-dynamic';

interface Post {
  id: string;
  title: string;
  content?: string;
  createdAt: string;
  author?: {
    name?: string;
  };
}

async function getRecentPosts() {
  try {
    const res = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/home/recent-posts`, {
      // Don't cache - fetch fresh posts on every request
      cache: 'no-store'
    });
    const data = await res.json();
    return data.posts || [];
  } catch {
    return [];
  }
}

export default async function Home() {
  const posts = await getRecentPosts();
  const session = await auth();

  // Skip portfolio check in ISR mode - it will be checked client-side when navigating
  // This prevents DB timeout issues during static generation
  const hasPortfolio = false;

  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen">
      {/* Marquee Banner */}
      <div className="sticky top-0 z-40"><MarqueeBanner /></div>

      {/* ── HERO / Chart Section ── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-4">
        {/* Page title */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white sm:text-5xl md:text-6xl">
            <span className="block xl:inline">Market Intelligence by</span>{' '}
            <span className="block text-blue-600 dark:text-blue-400">TradeNext</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Live indices, charts &amp; corporate events
          </p>
          <StockSearchBar />
        </div>

        {/* Full-width chart — hero element */}
        <div className="mb-6">
          <Suspense fallback={<ChartLoader />}>
            <HomeChart symbol="NIFTY 50" />
          </Suspense>
        </div>
      </section>

      {/* ── Secondary Feed Section ── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Corporate Announcements */}
          <CorporateAnnouncementsWidget />

          {/* Right: Corporate Actions + Quick Links */}
          <div className="space-y-4">
            <IndexCorporateActions symbol="NIFTY 50" />

            {/* Quick Access Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
              <Link
                href="/markets"
                className="group flex flex-col items-center justify-center gap-1.5 p-4 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all text-center"
              >
                <span className="text-2xl">📊</span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400 group-hover:underline">Markets</span>
                <span className="text-xs text-gray-400 dark:text-slate-500">All Indices</span>
              </Link>

              <Link
                href={hasPortfolio ? "/portfolio" : "/portfolio/new"}
                className="group flex flex-col items-center justify-center gap-1.5 p-4 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-md transition-all text-center"
              >
                <span className="text-2xl">💼</span>
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 group-hover:underline">
                  {hasPortfolio ? "Portfolio" : "Create Portfolio"}
                </span>
                <span className="text-xs text-gray-400 dark:text-slate-500">
                  {hasPortfolio ? "My Assets" : "Get Started"}
                </span>
              </Link>

              <Link
                href="/markets/analytics"
                className="group flex flex-col items-center justify-center gap-1.5 p-4 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 hover:border-purple-400 dark:hover:border-purple-500 hover:shadow-md transition-all text-center"
              >
                <span className="text-2xl">🔍</span>
                <span className="text-sm font-bold text-purple-600 dark:text-purple-400 group-hover:underline">Analytics</span>
                <span className="text-xs text-gray-400 dark:text-slate-500">Screener</span>
              </Link>

              <Link
                href="/news"
                className="group flex flex-col items-center justify-center gap-1.5 p-4 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-md transition-all text-center"
              >
                <span className="text-2xl">📰</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 group-hover:underline">News</span>
                <span className="text-xs text-gray-400 dark:text-slate-500">Market News</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Community Section ── */}
      {posts.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-gray-200 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Latest from Community</h2>
            <Link href="/posts" className="text-blue-600 hover:text-blue-700 font-medium text-sm">
              View all &rarr;
            </Link>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post: Post) => (
              <Link key={post.id} href={`/posts/${post.id}`} className="group block h-full">
                <div className="h-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                      Discussion
                    </span>
                    <span className="text-xs text-gray-400 dark:text-slate-500">
                      {new Date(post.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-base font-bold mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                    {post.title}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-slate-400 line-clamp-2 mb-4">
                    {post.content || "No preview available."}
                  </p>
                  <div className="flex items-center text-sm text-gray-400 dark:text-slate-500 mt-auto">
                    <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center mr-2 text-xs font-bold">
                      {post.author?.name?.[0] || "A"}
                    </div>
                    {post.author?.name || "Anonymous"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
