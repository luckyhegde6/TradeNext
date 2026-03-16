"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";

export default function AdminDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/");
    }
  }, [session, status, router]);

  if (status === "loading" || !session || !session.user || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Checking permissions...</div>
      </div>
    );
  }

  const adminSections = [
    {
      title: "User Management",
      description: "Manage user accounts, roles, and permissions",
      href: "/admin/users",
      icon: "👥",
      color: "bg-blue-500",
    },
    {
      title: "Corporate Actions",
      description: "Upload and manage dividends, splits, bonus, rights",
      href: "/admin/corporate-actions",
      icon: "💰",
      color: "bg-green-500",
    },
    {
      title: "Recommendations",
      description: "Manage stock recommendations for users",
      href: "/admin/recommendations",
      icon: "📈",
      color: "bg-purple-500",
    },
    {
      title: "Holdings Management",
      description: "View and manage user holdings",
      href: "/admin/holdings",
      icon: "📊",
      color: "bg-orange-500",
    },
    {
      title: "Alerts Management",
      description: "Manage user alerts and notifications",
      href: "/admin/alerts",
      icon: "🔔",
      color: "bg-yellow-500",
    },
    {
      title: "Audit Logs",
      description: "View system audit trail and logs",
      href: "/admin/audit",
      icon: "📋",
      color: "bg-gray-500",
    },
    {
      title: "Admin Utilities",
      description: "Data ingestion, NSE sync, tasks, workers, and system tools",
      href: "/admin/utils",
      icon: "🛠️",
      color: "bg-red-500",
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white">
          Admin Dashboard
        </h1>
        <p className="mt-2 text-gray-600 dark:text-slate-400">
          Manage TradeNext system and data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {adminSections.map((section) => (
          <Link
            key={section.title}
            href={section.href}
            className="group bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6 hover:shadow-md transition-all duration-200 hover:border-blue-200 dark:hover:border-blue-800"
          >
            <div className="flex items-start gap-4">
              <div className={`${section.color} p-3 rounded-lg text-white text-2xl shadow-lg`}>
                {section.icon}
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {section.title}
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                  {section.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
