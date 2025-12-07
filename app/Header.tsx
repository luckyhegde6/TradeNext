"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { signIn, signOut } from "next-auth/react";

export default function Header() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isLoggedIn = status === "authenticated";

  interface UserWithRole {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
  }

  const user = session?.user as UserWithRole;
  const isAdmin = user?.role === "admin";

  const isActive = (path: string) => pathname === path;

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-lg bg-white/80 border-b border-gray-200 dark:bg-slate-900/80 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Brand */}
          <div className="flex-shrink-0 flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xl">T</span>
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400">
                TradeNext
              </span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex space-x-8">
            <NavLink href="/" active={isActive("/")}>
              Dashboard
            </NavLink>

            {isLoggedIn ? (
              <NavLink href="/portfolio" active={isActive("/portfolio")}>
                Portfolio
              </NavLink>
            ) : (
              <button
                onClick={() => signIn()}
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-slate-400 dark:hover:text-slate-200`}
              >
                Portfolio
              </button>
            )}

            <NavLink href="/markets" active={isActive("/markets")}>
              Markets
            </NavLink>
            <NavLink href="/posts" active={isActive("/posts")}>
              Community
            </NavLink>

            {isAdmin && (
              <>
                <NavLink href="/admin/users" active={isActive("/admin/users")}>
                  Admin Users
                </NavLink>
                <NavLink href="/admin/utils" active={pathname?.startsWith("/admin/utils") || false}>
                  Utils
                </NavLink>
              </>
            )}
          </nav>

          {/* User Actions */}
          <div className="flex items-center space-x-4">
            {isLoggedIn ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {user?.name || user?.email}
                </span>
                <button
                  onClick={() => signOut()}
                  className="hidden sm:inline-flex items-center justify-center px-4 py-2 border border-blue-600 text-sm font-medium rounded-md text-blue-600 bg-white hover:bg-blue-50 transition-all shadow-sm"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn()}
                className="hidden sm:inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-sm"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200 ${active
        ? "border-blue-500 text-gray-900 dark:text-white"
        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-slate-400 dark:hover:text-slate-200"
        }`}
    >
      {children}
    </Link>
  );
}
