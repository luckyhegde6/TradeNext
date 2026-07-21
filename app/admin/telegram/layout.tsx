"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const telegramNavItems = [
  { name: "Overview", href: "/admin/telegram", icon: "📊" },
  { name: "Broadcast", href: "/admin/telegram/broadcast", icon: "📨" },
  { name: "Subscribers", href: "/admin/telegram/subscribers", icon: "👥" },
  { name: "Delivery Logs", href: "/admin/telegram/deliveries", icon: "📋" },
  { name: "Settings", href: "/admin/telegram/settings", icon: "⚙️" },
];

function getPageTitle(pathname: string): string {
  const item = telegramNavItems.find(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/")
  );
  return item?.name || "Telegram";
}

export default function TelegramAdminLayout({
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
            <Link
              href="/admin"
              className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
            >
              ← Admin Panel
            </Link>
            <h2 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight mt-2">
              Telegram
            </h2>
            <p className="text-[10px] font-semibold text-gray-400 dark:text-slate-500 mt-1">
              Bot management & broadcasts
            </p>
          </div>
          <nav className="flex-1 px-4 space-y-1">
            {telegramNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/admin/telegram" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`group flex items-center gap-3 px-3 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    isActive
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                      : "text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
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
                  href="/admin/telegram"
                  className="ml-1 text-sm font-medium text-gray-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 md:ml-2"
                >
                  Telegram
                </Link>
              </div>
            </li>
            {pathname !== "/admin/telegram" && (
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
            )}
          </ol>
        </nav>

        {children}
      </main>
    </div>
  );
}
