import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const { auth } = NextAuth(authConfig);

const ADMIN_KEY = process.env.ADMIN_KEY || "";

function checkAdminKey(req: NextRequest) {
    if (!ADMIN_KEY) return false;
    const headerKey = req.headers.get("x-admin-key");
    if (headerKey && headerKey === ADMIN_KEY) return true;
    const cookieKey = req.cookies.get("admin_key")?.value;
    if (cookieKey && cookieKey === ADMIN_KEY) return true;
    return false;
}

// Wrap NextAuth auth handler but add pre-check for docs routes
export default auth((req: any) => {
    // req is NextRequest with added auth by next-auth
    const { nextUrl } = req;
    const pathname = nextUrl.pathname;

    // Allow admin-key to access docs/openapi without redirecting to login
    if (pathname.startsWith("/docs") || pathname === "/api/openapi") {
        if (checkAdminKey(req)) return NextResponse.next();
        // otherwise fall through to normal auth behaviour (so sign-in will be required)
    }

    const isLoggedIn = !!req.auth;
    const user = req.auth?.user as any; // Cast to any to access role
    const isAdmin = user?.role === "admin";

    // Protected routes
    const isProtected =
        nextUrl.pathname.startsWith("/portfolio") ||
        nextUrl.pathname.startsWith("/posts/new") ||
        nextUrl.pathname.startsWith("/users/new");

    const isAdminRoute = nextUrl.pathname.startsWith("/admin");

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

export const config = {
    matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};