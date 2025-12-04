export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";

export default async function Home() {
  // Lazy-load Prisma
  const { default: prisma } = await import("@/lib/prisma");

  // Fetch recent posts for the community section
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { author: { select: { name: true } } },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-white">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
          <div className="text-center">
            <h1 className="text-4xl tracking-tight font-extrabold sm:text-5xl md:text-6xl">
              <span className="block">Master the Markets with</span>
              <span className="block text-blue-600 dark:text-blue-400">TradeNext</span>
            </h1>
            <p className="mt-3 max-w-md mx-auto text-base text-gray-500 dark:text-slate-400 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
              Advanced analytics, real-time portfolio tracking, and community insights.
              Your all-in-one platform for intelligent trading.
            </p>
            <div className="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
              <div className="rounded-md shadow">
                <Link
                  href="/portfolio"
                  className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg transition-all"
                >
                  View Portfolio
                </Link>
              </div>
              <div className="mt-3 rounded-md shadow sm:mt-0 sm:ml-3">
                <Link
                  href="/markets"
                  className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-blue-600 bg-white hover:bg-gray-50 md:py-4 md:text-lg transition-all border-gray-200 dark:bg-slate-800 dark:text-blue-400 dark:border-slate-700 dark:hover:bg-slate-700"
                >
                  Analyze Markets
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold mb-8 text-gray-900 dark:text-white">Quick Access</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Feature 1 */}
          <Link href="/portfolio" className="group block p-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm hover:shadow-md border border-gray-200 dark:border-slate-800 transition-all">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>
            </div>
            <h3 className="text-lg font-semibold mb-2 group-hover:text-blue-600 transition-colors">Portfolio Tracker</h3>
            <p className="text-gray-500 dark:text-slate-400">Track your holdings, analyze performance, and visualize asset allocation.</p>
          </Link>

          {/* Feature 2 */}
          <Link href="/markets" className="group block p-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm hover:shadow-md border border-gray-200 dark:border-slate-800 transition-all">
            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center mb-4 text-indigo-600 dark:text-indigo-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
            </div>
            <h3 className="text-lg font-semibold mb-2 group-hover:text-indigo-600 transition-colors">Market Analysis</h3>
            <p className="text-gray-500 dark:text-slate-400">Deep dive into company fundamentals, technical indicators, and financial health.</p>
          </Link>

          {/* Feature 3 */}
          <Link href="/posts" className="group block p-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm hover:shadow-md border border-gray-200 dark:border-slate-800 transition-all">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </div>
            <h3 className="text-lg font-semibold mb-2 group-hover:text-emerald-600 transition-colors">Community Insights</h3>
            <p className="text-gray-500 dark:text-slate-400">Connect with other traders, share strategies, and discuss market trends.</p>
          </Link>
        </div>
      </section>

      {/* Recent Posts Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-gray-200 dark:border-slate-800">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Latest from Community</h2>
          <Link href="/posts" className="text-blue-600 hover:text-blue-700 font-medium">View all &rarr;</Link>
        </div>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link key={post.id} href={`/posts/${post.id}`} className="group block h-full">
              <div className="h-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-6 hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-medium px-2.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                    Discussion
                  </span>
                  <span className="text-xs text-gray-500 dark:text-slate-500">
                    {new Date(post.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                  {post.title}
                </h3>
                <p className="text-gray-600 dark:text-slate-400 line-clamp-3 mb-4">
                  {post.content || "No preview available."}
                </p>
                <div className="flex items-center text-sm text-gray-500 dark:text-slate-500 mt-auto">
                  <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center mr-2 text-xs">
                    {post.author?.name?.[0] || "A"}
                  </div>
                  {post.author?.name || "Anonymous"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
