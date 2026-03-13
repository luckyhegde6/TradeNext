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
    cookies: {
        sessionToken: {
            name: isProduction ? "__Secure-next-auth.session-token" : "next-auth.session-token",
            options: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60, // 30 days
            },
        },
    },
} satisfies NextAuthConfig;
