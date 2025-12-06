import Link from "next/link";
import prisma from "@/lib/prisma";
import MarketStatus from "@/app/components/MarketStatus";
import HomeChart from "@/app/components/HomeChart";
import CorporateAnnouncementsWidget from "@/app/components/CorporateAnnouncementsWidget";

async function getRecentPosts() {
  try {
    const posts = await prisma.post.findMany({
      take: 3,
      orderBy: { createdAt: "desc" },
      include: {
        author: {
          select: { name: true },
        },
      },
    });
    return posts;
  } catch {
    return [];
  }
}

export const dynamic = 'force-dynamic';

export default async function Home() {
  const posts = await getRecentPosts();

  return (
    <div className="bg-white dark:bg-slate-950 min-h-screen">
      {/* Hero / Dashboard Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white sm:text-5xl md:text-6xl">
            <span className="block xl:inline">Market Intelligence by</span>{' '}
            <span className="block text-blue-600 dark:text-blue-400">TradeNext</span>
          </h1>
        </div>

        <div className="mb-6">
          <MarketStatus />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Chart Area - 3 Columns */}
          <div className="lg:col-span-3 space-y-6">
            <HomeChart />

            {/* Quick Actions / Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Link href="/markets" className="p-4 bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 hover:shadow-md transition-all text-center">
                <span className="block text-2xl font-bold text-blue-600">Indices</span>
                <span className="text-sm text-gray-500">Track Performance</span>
              </Link>
              <Link href="/portfolio" className="p-4 bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 hover:shadow-md transition-all text-center">
                <span className="block text-2xl font-bold text-indigo-600">Portfolio</span>
                <span className="text-sm text-gray-500">Manage Assets</span>
              </Link>
              <Link href="/posts" className="p-4 bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 hover:shadow-md transition-all text-center">
                <span className="block text-2xl font-bold text-emerald-600">Community</span>
                <span className="text-sm text-gray-500">Latest Insights</span>
              </Link>
              <div className="p-4 bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-800 text-center opacity-70">
                <span className="block text-xl font-bold text-gray-400">More</span>
                <span className="text-sm text-gray-500">Coming Soon</span>
              </div>
            </div>
          </div>

          {/* Sidebar - 1 Column */}
          <div className="lg:col-span-1">
            <CorporateAnnouncementsWidget />
          </div>
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
