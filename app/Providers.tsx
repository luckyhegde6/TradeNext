"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider 
      // Prevent automatic session refetch on window focus - prevents stale session issues
      refetchOnWindowFocus={false}
      // Disable automatic polling - session should only be refreshed explicitly
      refetchInterval={0}
      // Do NOT refetch when window regains focus
      // This is critical for logout to work properly
    >
      {children}
    </SessionProvider>
  );
}
