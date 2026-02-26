import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
    const isLoggedIn = !!req.auth;
    const { nextUrl } = req;
    const user = req.auth?.user as any; // Cast to any to access role
    const isAdmin = user?.role === "admin";

    // Protected routes
    const isProtected =
        nextUrl.pathname.startsWith("/portfolio") ||
        nextUrl.pathname.startsWith("/posts/new");

    const isAdminRoute = 
        nextUrl.pathname.startsWith("/admin") || 
        nextUrl.pathname.startsWith("/docs") ||
        nextUrl.pathname.startsWith("/api/admin");

    // Redirect to login if accessing protected route while not logged in
    if ((isProtected || isAdminRoute) && !isLoggedIn) {
        return NextResponse.redirect(new URL("/api/auth/signin", nextUrl));
    }

    // Redirect to home if accessing admin route while not admin
    if (isAdminRoute && !isAdmin) {
        return NextResponse.redirect(new URL("/", nextUrl));
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
