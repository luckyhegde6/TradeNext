"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { signIn, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import ProfileModal from "@/app/components/modals/ProfileModal";

export default function Header() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isLoggedIn = status === "authenticated";
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);

  interface UserWithRole {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
    mobile?: string | null; // Added mobile
  }

  const user = session?.user as UserWithRole;
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (isLoggedIn) {
      fetch('/api/portfolio')
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
          if (data && (data.hasPortfolio || data.id)) {
            setHasPortfolio(true);
          } else {
            setHasPortfolio(false);
          }
        })
        .catch(() => setHasPortfolio(false));
    } else {
      setHasPortfolio(null);
    }
  }, [isLoggedIn]);

  const isActive = (path: string) => pathname === path;

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-lg bg-surface/80 border-b border-border transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Brand */}
          <div className="flex-shrink-0 flex items-center">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                <span className="text-white font-bold text-xl">T</span>
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-indigo-500 dark:from-primary dark:to-indigo-400">
                TradeNext
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-8">
            <NavLink href="/" active={isActive("/")}>
              Dashboard
            </NavLink>

            {isLoggedIn ? (
              <>
                <NavLink
                  href={hasPortfolio === false ? "/portfolio/new" : "/portfolio"}
                  active={isActive("/portfolio") || isActive("/portfolio/new")}
                >
                  {hasPortfolio === false ? "Create Portfolio" : "Portfolio"}
                </NavLink>
                <NavLink
                  href="/alerts"
                  active={isActive("/alerts")}
                >
                  Alerts
                </NavLink>
              </>
            ) : (
              <button
                onClick={() => signIn()}
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200 border-transparent text-surface-foreground/60 hover:text-surface-foreground hover:border-primary/50`}
              >
                Portfolio
              </button>
            )}

            <NavLink href="/markets" active={isActive("/markets")}>
              Markets
            </NavLink>
            <NavLink href="/news/market" active={isActive("/news/market")}>
              News
            </NavLink>
            <NavLink href="/markets/analytics" active={isActive("/markets/analytics")}>
              Analytics
            </NavLink>
            {isLoggedIn && (
              <NavLink href="/markets/screener" active={isActive("/markets/screener")}>
                Screener
              </NavLink>
            )}
            <NavLink href="/posts" active={isActive("/posts")}>
              Community
            </NavLink>
            <NavLink href="/contact" active={isActive("/contact")}>
              Contact
            </NavLink>

            {isAdmin && (
              <>
                <NavLink href="/admin/utils" active={pathname?.startsWith("/admin/utils") || false}>
                  Admin Overview
                </NavLink>
                <NavLink href="/admin/users" active={isActive("/admin/users")}>
                  User Management
                </NavLink>
              </>
            )}
          </nav>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-surface-foreground/50 hover:text-surface-foreground hover:bg-surface focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              {/* Hamburger icon */}
              <svg className={`${isMobileMenuOpen ? 'hidden' : 'block'} h-6 w-6`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {/* Close icon */}
              <svg className={`${isMobileMenuOpen ? 'block' : 'hidden'} h-6 w-6`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="hidden md:flex items-center space-x-4">
            {isLoggedIn ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-surface-foreground/80">
                  {user?.name || user?.email}
                </span>
                <button
                  onClick={() => setIsProfileModalOpen(true)}
                  className="inline-flex items-center justify-center px-3 py-1.5 border border-border text-sm font-medium rounded-lg text-surface-foreground bg-surface hover:bg-primary/5 transition-all shadow-sm"
                >
                  Profile
                </button>
                <button
                  onClick={() => window.location.href = '/auth/signout'}
                  className="hidden sm:inline-flex items-center justify-center px-4 py-2 border border-primary/50 text-sm font-medium rounded-lg text-primary bg-surface hover:bg-primary/5 transition-all shadow-sm"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn()}
                className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-bold rounded-lg text-white bg-primary hover:opacity-90 transition-all shadow-md active:scale-95"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>

      {isProfileModalOpen && user && (
        <ProfileModal
          user={{
            id: user.id,
            name: user.name ?? "",
            email: user.email ?? "",
            role: user.role ?? "user",
            mobile: user.mobile
          }}
          onClose={() => setIsProfileModalOpen(false)}
          onUpdate={() => {
            // Optional: refresh session or show success
          }}
        />
      )}

      {/* Mobile menu */}
      <div className={`${isMobileMenuOpen ? 'block' : 'hidden'} md:hidden`}>
        <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
          <MobileNavLink href="/" active={isActive("/")} onClick={() => setIsMobileMenuOpen(false)}>
            Dashboard
          </MobileNavLink>

          {isLoggedIn ? (
            <MobileNavLink href="/portfolio" active={isActive("/portfolio")} onClick={() => setIsMobileMenuOpen(false)}>
              Portfolio
            </MobileNavLink>
          ) : (
            <button
              onClick={() => { signIn(); setIsMobileMenuOpen(false); }}
              className="block w-full text-left px-3 py-2 text-base font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 rounded-md"
            >
              Portfolio
            </button>
          )}

          <MobileNavLink href="/markets" active={isActive("/markets")} onClick={() => setIsMobileMenuOpen(false)}>
            Markets
          </MobileNavLink>
          <MobileNavLink href="/posts" active={isActive("/posts")} onClick={() => setIsMobileMenuOpen(false)}>
            Community
          </MobileNavLink>
          <MobileNavLink href="/contact" active={isActive("/contact")} onClick={() => setIsMobileMenuOpen(false)}>
            Contact
          </MobileNavLink>

          {isAdmin && (
            <>
              <MobileNavLink href="/admin/utils" active={pathname?.startsWith("/admin/utils") || false} onClick={() => setIsMobileMenuOpen(false)}>
                Admin Overview
              </MobileNavLink>
              <MobileNavLink href="/admin/users" active={isActive("/admin/users")} onClick={() => setIsMobileMenuOpen(false)}>
                User Management
              </MobileNavLink>
            </>
          )}

          {/* Mobile User Actions */}
          <div className="pt-4 pb-3 border-t border-gray-200 dark:border-slate-800">
            {isLoggedIn ? (
              <div className="flex items-center px-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-slate-300">
                    {user?.name?.[0] || user?.email?.[0] || "U"}
                  </div>
                </div>
                <div className="ml-3">
                  <div className="text-base font-medium text-gray-800 dark:text-slate-200">
                    {user?.name || user?.email}
                  </div>
                </div>
                <button
                  onClick={() => { window.location.href = '/auth/signout'; }}
                  className="ml-auto bg-blue-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className="px-3">
                <button
                  onClick={() => { signIn(); setIsMobileMenuOpen(false); }}
                  className="w-full bg-blue-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
                >
                  Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200 ${active
        ? "border-blue-500 text-gray-900 dark:text-white"
        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-slate-400 dark:hover:text-slate-200"
        }`}
    >
      {children}
    </Link>
  );
}


function MobileNavLink({
  href,
  active,
  children,
  onClick,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`block px-3 py-2 text-base font-medium rounded-md transition-colors duration-200 ${active
        ? "bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
        : "text-gray-500 hover:text-gray-900 hover:bg-gray-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
        }`}
    >
      {children}
    </Link>
  );
}
