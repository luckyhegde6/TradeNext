import type { NextAuthConfig } from "next-auth";
import logger from "./logger";

const isProduction = process.env.NODE_ENV === "production";



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
    },
    cookies: {
        sessionToken: {
            name: `tradenext-session-token`,
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: isProduction,
            },
        },
    },
    providers: [],
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isAuthPage = nextUrl.pathname.startsWith("/auth");
            const isAdminPage = nextUrl.pathname.startsWith("/admin") || nextUrl.pathname.startsWith("/users");
            const isAccessDeniedPage = nextUrl.pathname === "/admin/access-denied";

            if (isAdminPage && !isAccessDeniedPage) {
                if (isLoggedIn && (auth.user as any).role === "admin") return true;
                const callbackUrl = encodeURIComponent(nextUrl.pathname);

                if (isLoggedIn) {
                    // Logged in but not admin → access denied
                    return Response.redirect(new URL("/admin/access-denied", nextUrl));
                }
                // Not logged in → sign in
                return Response.redirect(new URL(`/auth/signin?callbackUrl=${callbackUrl}`, nextUrl));
            }

            if (isAuthPage) {
                if (isLoggedIn) {
                    return Response.redirect(new URL("/", nextUrl));
                }
                return true;
            }

            return true;
        },
    },
} satisfies NextAuthConfig;

// Export constant for CSRF token verification
export const CSRF_TOKEN_SIZE = 32;
