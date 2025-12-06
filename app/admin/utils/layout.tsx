"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
    { name: "Overview", href: "/admin/utils" },
    { name: "Ingest ZIP", href: "/admin/utils/ingest-zip" },
    { name: "Ingest CSV", href: "/admin/utils/ingest-csv" },
    { name: "Workers", href: "/admin/utils/workers" },
    { name: "Cron Config", href: "/admin/utils/cron" },
    { name: "Announcements", href: "/admin/utils/announcements" },
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
            <aside className="w-64 bg-white border-r border-gray-200 hidden md:block">
                <div className="h-full flex flex-col pt-5 pb-4 overflow-y-auto">
                    <div className="px-6 mb-6">
                        <h2 className="text-lg font-bold text-gray-900">Admin Utils</h2>
                    </div>
                    <nav className="flex-1 px-4 space-y-1">
                        {navItems.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors ${isActive
                                        ? "bg-blue-50 text-blue-600"
                                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
            <main className="flex-1 overflow-auto bg-gray-50 p-8">
                {children}
            </main>
        </div>
    );
}
