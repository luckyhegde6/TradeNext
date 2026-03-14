import type { NextAuthConfig } from "next-auth";
import logger from "./logger";

const isProduction = process.env.NODE_ENV === "production";

logger.info({ msg: "Auth Config: Loading", environment: process.env.NODE_ENV, isProduction });

export const authConfig: NextAuthConfig = {
    trustHost: true,
    debug: !isProduction,
    pages: {
        signIn: "/auth/signin",
        error: "/auth/error",
    },
    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60, // 30 days
        updateAge: 24 * 60 * 60, // Update session every 24 hours
    },
    providers: [],
    callbacks: {
        // Add additional claims to JWT
        async jwt({ token, user, trigger, session }) {
            if (user) {
                // Initial sign in
                token.role = user.role;
                token.id = user.id;
                token.mobile = user.mobile;
                token.iat = Math.floor(Date.now() / 1000); // Issue time
            }
            
            // Add current time to token for expiry checks
            token.currentTime = Math.floor(Date.now() / 1000);
            
            // Handle session updates
            if (trigger === "update" && session) {
                token.name = session.name;
                token.mobile = session.mobile;
            }
            
            return token;
        },
    },
    events: {
        async signIn({ user, account, profile }) {
            logger.info({ 
                msg: "Auth: User signed in", 
                userId: user.id, 
                email: user.email,
                provider: account?.provider 
            });
        },
        async session({ session, token }) {
            // Add token validation
            if (token) {
                // Verify token is not expired
                const tokenExpiry = token.exp as number;
                const currentTime = Math.floor(Date.now() / 1000);
                
                if (tokenExpiry && tokenExpiry < currentTime) {
                    logger.warn({ msg: "Auth: Token expired", userId: token.id });
                }
                
                session.user.id = token.id as string;
                session.user.role = token.role as string;
                session.user.mobile = token.mobile as string | null;
            }
        },
    },
    cookies: {
        sessionToken: {
            name: isProduction ? "__Secure-next-auth.session-token" : "next-auth.session-token",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "strict", // Changed from "lax" for better security
                path: "/",
                maxAge: 30 * 24 * 60 * 60, // 30 days
            },
        },
        callbackUrl: {
            name: isProduction ? "__Secure-next-auth.callback-url" : "next-auth.callback-url",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "strict",
                path: "/",
                maxAge: 60 * 60, // 1 hour
            },
        },
        csrfToken: {
            name: isProduction ? "__Secure-next-auth.csrf-token" : "next-auth.csrf-token",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "strict",
                path: "/",
                maxAge: 60 * 60, // 1 hour
            },
        },
        // Anti-csrf token for state/pkce
        pkceCodeVerifier: {
            name: "next-auth.pkce.code_verifier",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "strict",
                path: "/",
                maxAge: 60 * 15, // 15 minutes
            },
        },
        state: {
            name: "next-auth.state",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "strict",
                path: "/",
                maxAge: 60 * 15, // 15 minutes
            },
        },
    },
} satisfies NextAuthConfig;

// Export constant for CSRF token verification
export const CSRF_TOKEN_SIZE = 32;
