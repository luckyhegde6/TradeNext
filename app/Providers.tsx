"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { useEffect, useCallback, createContext, useContext, useState } from "react";

interface SessionRefreshContextType {
  refreshSession: () => Promise<void>;
  isRefreshing: boolean;
}

const SessionRefreshContext = createContext<SessionRefreshContextType>({
  refreshSession: async () => {},
  isRefreshing: false,
});

export function useSessionRefresh() {
  return useContext(SessionRefreshContext);
}

function SessionRefreshHandler({ children }: { children: React.ReactNode }) {
  const { data: session, status, update } = useSession();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Function to manually refresh the session
  const refreshSession = useCallback(async () => {
    if (status !== "authenticated") return;
    
    setIsRefreshing(true);
    try {
      // Call the NextAuth session refresh endpoint
      await fetch('/api/auth/session', { method: 'GET' });
      // Also trigger the useSession update
      await update();
    } catch (error) {
      console.error('Session refresh error:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [status, update]);

  // Check for session invalidation periodically
  useEffect(() => {
    if (status !== "authenticated") return;

    // Check session validity every 30 seconds
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/auth/session', { 
          method: 'GET',
          credentials: 'include'
        });
        
        if (!response.ok) {
          // Session might be invalid - trigger refresh to check
          await update();
        }
      } catch (error) {
        console.error('Session check error:', error);
      }
    }, 30000); // 30 seconds

    return () => clearInterval(checkInterval);
  }, [status, update]);

  // Handle window focus - refresh session when user comes back
  useEffect(() => {
    if (status !== "authenticated") return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // User came back to the tab - refresh session
        try {
          await update();
        } catch (error) {
          console.error('Session refresh on visibility error:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [status, update]);

  // Handle network online/offline
  useEffect(() => {
    if (status !== "authenticated") return;

    const handleOnline = async () => {
      // Network came back - refresh session
      try {
        await update();
      } catch (error) {
        console.error('Session refresh on online error:', error);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [status, update]);

  return (
    <SessionRefreshContext.Provider value={{ refreshSession, isRefreshing }}>
      {children}
    </SessionRefreshContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider 
      refetchOnWindowFocus={false}
      refetchInterval={0}
    >
      <SessionRefreshHandler>
        {children}
      </SessionRefreshHandler>
    </SessionProvider>
  );
}
