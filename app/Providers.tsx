"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider 
            refetchOnWindowFocus={true}
            refetchInterval={60}
        >
            {children}
        </SessionProvider>
    );
}
