import type { NextAuthConfig } from "next-auth";
import logger from "./logger";

const isProduction = process.env.NODE_ENV === "production";

logger.info({ msg: "Auth Config: Loading", environment: process.env.NODE_ENV, isProduction });

export const authConfig = {
    trustHost: true,
    debug: !isProduction,
    pages: {
        signIn: "/auth/signin",
    },
    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60, // 30 days
    },
    providers: [],
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isOnDashboard = nextUrl.pathname.startsWith("/portfolio") || 
                                  nextUrl.pathname.startsWith("/admin") ||
                                  nextUrl.pathname.startsWith("/alerts") ||
                                  nextUrl.pathname.startsWith("/watchlist");
            
            if (isOnDashboard) {
                if (isLoggedIn) return true;
                return false; // Redirect to login page
            } else if (isLoggedIn && nextUrl.pathname === "/auth/signin") {
                return Response.redirect(new URL("/", nextUrl));
            }
            return true;
        },
    },
    cookies: {
        sessionToken: {
            name: isProduction ? "__Secure-next-auth.session-token" : "next-auth.session-token",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60, // 30 days
                domain: isProduction ? ".netlify.app" : undefined,
            },
        },
        callbackUrl: {
            name: isProduction ? "__Secure-next-auth.callback-url" : "next-auth.callback-url",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "lax",
                path: "/",
                domain: isProduction ? ".netlify.app" : undefined,
            },
        },
        csrfToken: {
            name: isProduction ? "__Secure-next-auth.csrf-token" : "next-auth.csrf-token",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "lax",
                path: "/",
                domain: isProduction ? ".netlify.app" : undefined,
            },
        },
    },
} satisfies NextAuthConfig;
