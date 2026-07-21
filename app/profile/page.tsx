"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import TelegramSubscription from "@/app/components/alerts/TelegramSubscription";

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-900 dark:via-slate-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-slate-400 font-medium">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-900 dark:via-slate-800 dark:to-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Profile Settings
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            Manage your account and notification preferences
          </p>
        </div>

        {/* User Info Card */}
        <div className="bg-white dark:bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-gray-200 dark:border-slate-700/50 p-6 mb-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Account Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">Name</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{session.user?.name || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">Email</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{session.user?.email || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">Role</p>
              <span className="px-2.5 py-1 text-[11px] font-bold uppercase rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                {session.user?.role || "user"}
              </span>
            </div>
          </div>
        </div>

        {/* Telegram Subscription */}
        <div className="bg-white dark:bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-gray-200 dark:border-slate-700/50 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Telegram Notifications</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            Link your Telegram account to receive real-time alerts and daily recommendations directly in Telegram.
          </p>
          <TelegramSubscription />
        </div>
      </div>
    </div>
  );
}
