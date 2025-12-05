import type { NextAuthConfig } from "next-auth";

export const authConfig = {
    pages: {
        signIn: "/auth/signin",
    },
    callbacks: {
        jwt({ token, user }) {
            if (user) {
                token.role = (user as unknown as { role: string }).role;
                token.id = (user as unknown as { id: string }).id;
            }
            return token;
        },
        session({ session, token }) {
            if (session.user) {
                (session.user as unknown as { role: string }).role = token.role as string;
                (session.user as unknown as { id: string }).id = token.id as string;
            }
            return session;
        },
    },
    providers: [],
} satisfies NextAuthConfig;
