"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const navItems = [
  { name: "Dashboard", href: "/admin" },
  { name: "AI Agents", href: "/admin/ai" },
  { name: "AI Monitoring", href: "/admin/utils/ai-monitoring" },
  { name: "Users", href: "/admin/users" },
  { name: "Sessions", href: "/admin/sessions" },
  { name: "Alerts", href: "/admin/alerts" },
  { name: "Daily Recommendations", href: "/admin/recommendations/daily" },
  { name: "Stock Picks (Manual)", href: "/admin/recommendations" },
  { name: "Holdings", href: "/admin/holdings" },
  { name: "Audit Logs", href: "/admin/audit" },
  { name: "Dividend Mgmt", href: "/admin/dividends" },
  { name: "Live Prices", href: "/admin/live-prices" },
  { name: "Tax Mgmt", href: "/admin/tax" },
  { name: "Rebalancer", href: "/admin/rebalance" },
  { name: "Corporate Actions", href: "/admin/corporate-actions" },
  { name: "Tasks", href: "/admin/utils/tasks" },
  { name: "Monitoring", href: "/admin/utils/monitoring" },
  { name: "Workers", href: "/admin/utils/workers" },
  { name: "Cron Config", href: "/admin/utils/cron" },
  { name: "Announcements", href: "/admin/utils/announcements" },
  { name: "NSE Sync", href: "/admin/utils/nse-sync" },
  { name: "Ingest ZIP", href: "/admin/utils/ingest-zip" },
  { name: "Ingest CSV", href: "/admin/utils/ingest-csv" },
  { name: "Docs", href: "/docs" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const router = useRouter();

  // Client-side admin check
  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/admin/access-denied");
    }
  }, [session, status, router]);

  if (status === "loading" || !session || !session.user || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Checking permissions...</div>
      </div>
    );
  }

  // Extract page title from pathname
  const getPageTitle = (p: string): string => {
    const map: Record<string, string> = {
      "/admin": "Dashboard",
      "/admin/ai": "AI Agents",
      "/admin/utils/ai-monitoring": "AI Monitoring",
      "/admin/users": "Users",
      "/admin/sessions": "Sessions",
      "/admin/alerts": "Alerts",
      "/admin/recommendations": "Recommendations",
      "/admin/holdings": "Holdings",
      "/admin/audit": "Audit Logs",
      "/admin/dividends": "Dividend Mgmt",
      "/admin/live-prices": "Live Prices",
      "/admin/tax": "Tax Mgmt",
      "/admin/rebalance": "Rebalancer",
      "/admin/corporate-actions": "Corporate Actions",
    };
    for (const [path, title] of Object.entries(map)) {
      if (p === path) return title;
      if (p.startsWith(path + "/")) return title;
    }
    return "Admin";
  };

  // For /admin/utils/* pages, the utils layout already provides its own sidebar
  const isUtilsPage = pathname.startsWith("/admin/utils");

  // For /admin/telegram/* pages, the telegram layout already provides its own sidebar
  const isTelegramPage = pathname.startsWith("/admin/telegram");

  if (isUtilsPage || isTelegramPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 hidden md:block transition-colors duration-300 overflow-y-auto">
        <div className="h-full flex flex-col pt-5 pb-4">
          <div className="px-6 mb-6">
            <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              Admin Panel
            </h2>
          </div>
          <nav className="flex-1 px-4 space-y-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`group flex items-center px-3 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    isActive
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                      : "text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-50/50 dark:bg-[#020617] p-8 transition-colors duration-300">
        {children}
      </main>
    </div>
  );
}
