"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import ProfileModal from "@/app/components/modals/ProfileModal";
import {
  HomeIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  BellIcon,
  Bars3Icon,
  XMarkIcon,
  ChevronRightIcon
} from "@heroicons/react/24/outline";

async function handleLogout() {
  try {
    // Call the signout endpoint
    const response = await fetch('/api/auth/signout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });
    
    // Force a full page reload to clear all client-side state
    // This ensures no cached session data persists
    window.location.reload();
  } catch (error) {
    console.error('Logout error:', error);
    // Fallback - try client-side signOut
    await signOut({ callbackUrl: '/' });
  }
}

export default function Header() {
  const pathname = usePathname();
  // Use ONLY NextAuth session - no localStorage for sensitive data
  const { data: session, status, update } = useSession();
  
  // Remove localStorage usage - session is handled securely via httpOnly cookies
  const isLoggingOut = status === "loading";
  
  // Use session data directly - no fallback to localStorage
  const isLoggedIn = status === "authenticated";
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  // Type for user from session
  interface UserWithRole {
    id: string;
    name: string | null;
    email: string;
    image?: string | null;
    role: string;
    mobile?: string | null;
  }

  // Get user directly from session (secure)
  const sessionUser = session?.user as UserWithRole | undefined;
  const user = sessionUser;
  const isAdmin = user?.role?.toLowerCase() === "admin";

  // Fetch user data only when authenticated via secure session
  useEffect(() => {
    if (isLoggedIn) {
      fetch("/api/portfolio")
        .then((res) => res.json())
        .then((data) => setHasPortfolio(data.hasPortfolio))
        .catch(() => setHasPortfolio(false));

      const fetchNotifications = async () => {
        try {
          const res = await fetch('/api/notifications');
          const data = await res.json();
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        } catch (err) {
          console.error('Error fetching notifications:', err);
        }
      };

      fetchNotifications();
      const interval = setInterval(fetchNotifications, 60000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn]);

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      setUnreadCount(0);
      setNotifications(notifications.map(n => ({ ...n, isRead: true })));
    } catch (err) {
      console.error('Error marking notifications as read:', err);
    }
  };

  const handleSignOut = async () => {
    console.log('Header: handleSignOut called');
    try {
      // Use NextAuth's signOut - it handles cookie clearing securely
      // No localStorage manipulation needed - session is in httpOnly cookies
      await signOut({ 
        callbackUrl: '/',
        redirect: true,
      });
    } catch (error) {
      console.error('Header: SignOut error', error);
      // Force redirect to home even if there's an error
      window.location.href = '/';
    }
  };

  const isActive = (path: string) => pathname === path;

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-lg bg-surface/80 border-b border-border transition-colors duration-200">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Brand */}
          <div className="flex-shrink-0 flex items-center">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <span className="text-white font-black text-xl sm:text-2xl">T</span>
              </div>
              <span className="text-xl sm:text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-indigo-600 dark:from-primary dark:to-indigo-400 hidden sm:block">
                TradeNext
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden xl:flex items-center space-x-1">
            <NavLink href="/" active={isActive("/")}>
              Dashboard
            </NavLink>

            {/* Portfolio – always visible; redirect to sign-in if not logged in */}
            {isLoggedIn ? (
              <NavLink
                href={hasPortfolio === false ? "/portfolio/new" : "/portfolio"}
                active={isActive("/portfolio") || isActive("/portfolio/new")}
              >
                {hasPortfolio === false ? "Create Portfolio" : "Portfolio"}
              </NavLink>
            ) : (
              <button
                onClick={() => signIn()}
                className="px-4 py-2 text-sm font-bold rounded-xl transition-all duration-200 text-gray-500 hover:text-gray-900 hover:bg-gray-100/80 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
              >
                Portfolio
              </button>
            )}

            {/* Logged-in only */}
            {isLoggedIn && (
              <>
                <NavLink href="/alerts" active={isActive("/alerts")}>
                  Alerts
                </NavLink>
                <NavLink href="/watchlist" active={isActive("/watchlist")}>
                  Watchlist
                </NavLink>
              </>
            )}

            {/* Public links */}
            <NavLink href="/markets" active={isActive("/markets")}>
              Markets
            </NavLink>
            <NavLink href="/markets/analytics" active={isActive("/markets/analytics")}>
              Analytics
            </NavLink>
            <NavLink href="/markets/calendar" active={isActive("/markets/calendar")}>
              Calendar
            </NavLink>
            <NavLink href="/news" active={isActive("/news")}>
              News
            </NavLink>

            {/* Screener – logged in only */}
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
              <div className="ml-4 pl-4 border-l border-border flex items-center space-x-1">
                <NavLink href="/admin/utils" active={pathname?.startsWith("/admin/utils") || false}>
                  Admin
                </NavLink>
                <NavLink href="/admin/users" active={isActive("/admin/users")}>
                  Users
                </NavLink>
              </div>
            )}
          </nav>

          {/* Action Area */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            {isLoggedIn ? (
              <div className="flex items-center gap-2 sm:gap-4">
                {/* Notifications */}
                <div className="relative">
                  <button
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="relative p-2 text-surface-foreground/60 hover:text-surface-foreground hover:bg-surface/50 rounded-lg transition-colors"
                  >
                    <BellIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                    {unreadCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 bg-red-600 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>
                  {showNotifications && (
                    <div className="absolute right-0 mt-3 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 overflow-hidden z-[100] animate-in slide-in-from-top-2 duration-200">
                      <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-gray-900 dark:text-white">Notifications</h3>
                        {unreadCount > 0 && (
                          <button
                            onClick={markAllRead}
                            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      <div className="max-h-96 overflow-y-auto custom-scrollbar">
                        {notifications.length === 0 ? (
                          <div className="px-5 py-10 text-center text-gray-400 dark:text-slate-500 italic text-sm">
                            No notifications yet
                          </div>
                        ) : (
                          notifications.map((notification) => (
                            <a
                              key={notification.id}
                              href={notification.link || '#'}
                              className={`block px-5 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800 last:border-0 transition-colors ${!notification.isRead ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                            >
                              <p className="font-bold text-sm text-gray-900 dark:text-white leading-tight">{notification.title}</p>
                              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 line-clamp-2">{notification.message}</p>
                              <p className="text-[10px] font-medium text-gray-400 dark:text-slate-500 mt-2 uppercase tracking-tight">
                                {new Date(notification.createdAt).toLocaleString()}
                              </p>
                            </a>
                          ))
                        )}
                      </div>
                      <Link
                        href="/notifications"
                        className="block px-5 py-3 text-center text-xs font-bold text-blue-600 dark:text-blue-400 border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        VIEW ALL
                      </Link>
                    </div>
                  )}
                </div>

                <div className="hidden md:flex items-center gap-3">
                  <div className="text-right flex flex-col">
                    <span className="text-xs font-black text-gray-900 dark:text-white truncate max-w-[120px]">
                      {user?.name || user?.email?.split('@')[0]}
                    </span>
                    <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest leading-none">
                      {user?.role || 'User'}
                    </span>
                  </div>
                  <button
                    onClick={() => setIsProfileModalOpen(true)}
                    className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-slate-800 border-2 border-transparent hover:border-primary/30 flex items-center justify-center text-sm font-black text-primary transition-all shadow-sm"
                  >
                    {user?.name?.[0] || 'U'}
                  </button>
                  <button
                    onClick={() => handleSignOut()}
                    className="p-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-colors group"
                    title="Sign Out"
                  >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => signIn()}
                className="inline-flex items-center justify-center px-6 py-2.5 bg-primary text-white text-sm font-black rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 active:scale-95 whitespace-nowrap"
              >
                SIGN IN
              </button>
            )}

            {/* Mobile menu button */}
            <div className="flex items-center xl:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-xl text-surface-foreground hover:bg-surface transition-colors focus:outline-none"
              >
                {isMobileMenuOpen ? (
                  <XMarkIcon className="h-6 w-6" />
                ) : (
                  <Bars3Icon className="h-6 w-6" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className={`${isMobileMenuOpen ? 'block animate-in slide-in-from-top-4 duration-300' : 'hidden'} xl:hidden border-t border-border bg-white dark:bg-slate-900 absolute w-full left-0 z-[60] shadow-2xl`}
      >
        <div className="px-4 pt-4 pb-8 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            <MobileNavLink href="/" active={isActive("/")} onClick={() => setIsMobileMenuOpen(false)}>
              <span className="flex items-center gap-2">
                <HomeIcon className="w-4 h-4" /> Dashboard
              </span>
            </MobileNavLink>

            {isLoggedIn ? (
              <MobileNavLink href="/portfolio" active={isActive("/portfolio")} onClick={() => setIsMobileMenuOpen(false)}>
                Portfolio
              </MobileNavLink>
            ) : (
              <button
                onClick={() => { signIn(); setIsMobileMenuOpen(false); }}
                className="flex items-center justify-center px-4 py-3 text-sm font-bold text-gray-600 dark:text-slate-400 hover:text-primary hover:bg-primary/5 rounded-2xl transition-all border border-border"
              >
                Portfolio
              </button>
            )}
          </div>

          <div className="space-y-1">
            <h4 className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest pl-3 mb-2">Market Data</h4>
            <div className="grid grid-cols-1 gap-1">
              <MobileNavLink href="/markets" active={isActive("/markets")} onClick={() => setIsMobileMenuOpen(false)}>Markets</MobileNavLink>
              <MobileNavLink href="/markets/analytics" active={isActive("/markets/analytics")} onClick={() => setIsMobileMenuOpen(false)}>Analytics</MobileNavLink>
              <MobileNavLink href="/news" active={isActive("/news")} onClick={() => setIsMobileMenuOpen(false)}>News</MobileNavLink>
              {isLoggedIn && <MobileNavLink href="/markets/screener" active={isActive("/markets/screener")} onClick={() => setIsMobileMenuOpen(false)}>Screener</MobileNavLink>}
              <MobileNavLink href="/watchlist" active={isActive("/watchlist")} onClick={() => setIsMobileMenuOpen(false)}>Watchlist</MobileNavLink>
            </div>
          </div>

          <div className="space-y-1">
            <h4 className="text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest pl-3 mb-2">Platform</h4>
            <div className="grid grid-cols-1 gap-1">
              <MobileNavLink href="/posts" active={isActive("/posts")} onClick={() => setIsMobileMenuOpen(false)}>Community</MobileNavLink>
              <MobileNavLink href="/contact" active={isActive("/contact")} onClick={() => setIsMobileMenuOpen(false)}>Contact</MobileNavLink>
            </div>
          </div>

          {isAdmin && (
            <div className="space-y-1 pt-2">
              <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-widest pl-3 mb-2 font-black">Administration</h4>
              <div className="grid grid-cols-2 gap-3">
                <MobileNavLink href="/admin/utils" active={pathname?.startsWith("/admin/utils") || false} onClick={() => setIsMobileMenuOpen(false)}>Overview</MobileNavLink>
                <MobileNavLink href="/admin/users" active={isActive("/admin/users")} onClick={() => setIsMobileMenuOpen(false)}>Users</MobileNavLink>
              </div>
            </div>
          )}

          {/* User Profile Section */}
          {isLoggedIn && (
            <div className="pt-6 border-t border-border">
              <div className="flex items-center justify-between bg-gray-50 dark:bg-slate-800/50 p-4 rounded-3xl border border-border">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setIsProfileModalOpen(true); setIsMobileMenuOpen(false); }}
                    className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-700 flex items-center justify-center text-lg font-black text-primary shadow-sm border border-border"
                  >
                    {user?.name?.[0] || 'U'}
                  </button>
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-gray-900 dark:text-white line-clamp-1">{user?.name || user?.email}</span>
                    <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">{user?.role}</span>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-2xl transition-colors"
                >
                  <ArrowRightOnRectangleIcon className="h-6 w-6" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isProfileModalOpen && user && (
        <ProfileModal
          user={user}
          onClose={() => setIsProfileModalOpen(false)}
          onUpdate={() => window.location.reload()}
        />
      )}
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
      className={`px-4 py-2 text-sm font-bold rounded-xl transition-all duration-200 ${active
        ? "bg-primary/10 text-primary"
        : "text-gray-500 hover:text-gray-900 hover:bg-gray-100/80 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
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
      className={`flex items-center px-5 py-3.5 text-sm font-black rounded-2xl transition-all duration-200 ${active
        ? "bg-primary text-white shadow-lg shadow-primary/20"
        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/80 border border-transparent hover:border-border"
        }`}
    >
      {children}
    </Link>
  );
}
