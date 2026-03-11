"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
    { name: "Overview", href: "/admin/utils" },
    { name: "Users", href: "/admin/users" },
    { name: "Alerts", href: "/admin/alerts" },
    { name: "Recommendations", href: "/admin/recommendations" },
    { name: "Holdings", href: "/admin/holdings" },
    { name: "Audit Logs", href: "/admin/audit" },
    { name: "Tasks", href: "/admin/utils/tasks" },
    { name: "Docs", href: "/docs" },
    { name: "Ingest ZIP", href: "/admin/utils/ingest-zip" },
    { name: "Ingest CSV", href: "/admin/utils/ingest-csv" },
    { name: "Workers", href: "/admin/utils/workers" },
    { name: "Cron Config", href: "/admin/utils/cron" },
    { name: "Announcements", href: "/admin/utils/announcements" },
    { name: "NSE Sync", href: "/admin/utils/nse-sync" },
];

export default function AdminUtilsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();

    return (
        <div className="flex min-h-[calc(100vh-4rem)]">
            {/* Sidebar */}
            <aside className="w-64 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 hidden md:block transition-colors duration-300">
                <div className="h-full flex flex-col pt-5 pb-4 overflow-y-auto">
                    <div className="px-6 mb-6">
                        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">Admin Utils</h2>
                    </div>
                    <nav className="flex-1 px-4 space-y-1">
                        {navItems.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    className={`group flex items-center px-3 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${isActive
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
