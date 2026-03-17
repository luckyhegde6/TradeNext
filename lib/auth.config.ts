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
            const isAdminPage = nextUrl.pathname.startsWith("/admin");

            if (isAdminPage) {
                if (isLoggedIn && (auth.user as any).role === "admin") return true;
                return false;
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
