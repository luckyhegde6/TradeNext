import type { NextAuthConfig } from "next-auth";

export const authConfig = {
    trustHost: true,
    pages: {
        signIn: "/auth/signin",
    },
    session: {
        strategy: "jwt",
    },
    providers: [],
} satisfies NextAuthConfig;
