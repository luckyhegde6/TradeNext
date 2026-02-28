import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
    const isLoggedIn = !!req.auth;
    const { nextUrl } = req;

    // Protected routes
    const isProtected =
        nextUrl.pathname.startsWith("/portfolio") ||
        nextUrl.pathname.startsWith("/posts/new");

    // Redirect to login if accessing protected route while not logged in
    if (isProtected && !isLoggedIn) {
        return NextResponse.redirect(new URL("/auth/signin?callbackUrl=" + encodeURIComponent(nextUrl.pathname), nextUrl));
    }

    return NextResponse.next();
});

// Updated matcher for Next.js 16 compatibility
export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
};
