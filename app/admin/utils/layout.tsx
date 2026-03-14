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
    { name: "Monitoring", href: "/admin/utils/monitoring" },
    { name: "Workers", href: "/admin/utils/workers" },
    { name: "Cron Config", href: "/admin/utils/cron" },
    { name: "Announcements", href: "/admin/utils/announcements" },
    { name: "NSE Sync", href: "/admin/utils/nse-sync" },
    { name: "Ingest ZIP", href: "/admin/utils/ingest-zip" },
    { name: "Ingest CSV", href: "/admin/utils/ingest-csv" },
    { name: "Docs", href: "/docs" },
];

// Get page title based on current path
function getPageTitle(pathname: string): string {
    const map: Record<string, string> = {
        "/admin/utils": "Admin Utils",
        "/admin/utils/ingest-zip": "Ingest ZIP",
        "/admin/utils/ingest-csv": "Ingest CSV",
        "/admin/utils/workers": "Workers",
        "/admin/utils/cron": "Cron Config",
        "/admin/utils/announcements": "Announcements",
        "/admin/utils/nse-sync": "NSE Sync",
        "/admin/utils/tasks": "Tasks",
        "/admin/utils/monitoring": "Monitoring",
    };
    // Find exact match or partial match
    for (const [path, title] of Object.entries(map)) {
        if (pathname === path) return title;
        // For subpaths like /admin/utils/ingest-csv/...
        if (pathname.startsWith(path + "/")) return title;
    }
    return "Admin Utils";
}

export default function AdminUtilsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const pageTitle = getPageTitle(pathname);

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
                {/* Breadcrumb */}
                <nav className="flex mb-6" aria-label="Breadcrumb">
                    <ol className="inline-flex items-center space-x-1 md:space-x-3">
                        <li className="inline-flex items-center">
                            <Link
                                href="/admin"
                                className="inline-flex items-center text-sm font-medium text-gray-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                                </svg>
                                Admin
                            </Link>
                        </li>
                        <li>
                            <div className="flex items-center">
                                <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                </svg>
                                <Link
                                    href="/admin/utils"
                                    className="ml-1 text-sm font-medium text-gray-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 md:ml-2"
                                >
                                    Utils
                                </Link>
                            </div>
                        </li>
                        <li aria-current="page">
                            <div className="flex items-center">
                                <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                </svg>
                                <span className="ml-1 text-sm font-medium text-gray-500 dark:text-slate-400 md:ml-2">
                                    {pageTitle}
                                </span>
                            </div>
                        </li>
                    </ol>
                </nav>

                {children}
            </main>
        </div>
    );
}
