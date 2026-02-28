import type { NextAuthConfig } from "next-auth";

const IDLE_TIMEOUT = 15 * 60; // 15 minutes in seconds

export const authConfig = {
    trustHost: true,
    pages: {
        signIn: "/auth/signin",
    },
    session: {
        strategy: "jwt",
        maxAge: 60 * 60, // 1 hour max session
    },
    callbacks: {
        jwt({ token, user }) {
            if (user) {
                token.role = (user as unknown as { role: string }).role;
                token.id = (user as unknown as { id: string }).id;
                (token as unknown as { lastActivity: number }).lastActivity = Date.now();
            }
            
            // Check idle timeout (15 min)
            const lastActivity = (token as unknown as { lastActivity?: number }).lastActivity;
            if (lastActivity) {
                const idleTime = (Date.now() - lastActivity) / 1000;
                if (idleTime > IDLE_TIMEOUT) {
                    return null; // Force logout
                }
            }
            
            // Update last activity on each token refresh
            (token as unknown as { lastActivity: number }).lastActivity = Date.now();
            
            return token;
        },
        session({ session, token }) {
            if (session.user) {
                (session.user as unknown as { role: string }).role = token.role as string;
                (session.user as unknown as { id: string }).id = token.id as string;
            }
            
            // If token is null (expired/timeout), return empty session
            if (!token) {
                return {} as typeof session;
            }
            
            return session;
        },
    },
    providers: [],
} satisfies NextAuthConfig;
