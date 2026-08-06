"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

export default function AccessDeniedPage() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-800 px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Lock icon */}
        <div className="mx-auto w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-10 h-10 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" />
          </svg>
        </div>

        {/* Title */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Access Denied
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            You do not have permission to access this page.
          </p>
        </div>

        {/* Explanation card */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-gray-200 dark:border-slate-700 shadow-sm space-y-3 text-left">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This area is restricted to <strong className="text-gray-900 dark:text-white">administrators</strong> only.
          </p>
          {session?.user && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              You are signed in as{" "}
              <span className="font-medium text-gray-900 dark:text-white">{session.user.email}</span>
              {" "}with role <span className="font-medium text-gray-900 dark:text-white capitalize">{session.user.role || "user"}</span>.
            </p>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            If you believe this is a mistake, please contact the system administrator.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 active:scale-95"
          >
            Go to Dashboard
          </Link>
          {session?.user && (
            <button
              onClick={() => {
                fetch("/api/auth/signout", { method: "POST" }).then(() => {
                  window.location.href = "/auth/signin";
                });
              }}
              className="inline-flex items-center justify-center px-6 py-3 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200 font-semibold rounded-xl border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 transition-all active:scale-95"
            >
              Sign out &amp; try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
