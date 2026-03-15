import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import { simpleRateLimit } from "@/lib/rate-limit";
import { logHttpRequest, info as loggerInfo } from "@/lib/logger";

// Startup log
loggerInfo({ msg: "Middleware: Server starting", environment: process.env.NODE_ENV });

// Use stable Node.js runtime for middleware (required for Prisma/Postgres)
export const runtime = 'nodejs';

const { auth } = NextAuth(authConfig);

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://tradenext6.netlify.app',
  'https://tradenext.vercel.app',
];

// Rate limit configuration
const RATE_LIMIT_WINDOW = 60; // 1 minute
const RATE_LIMIT_MAX = 100; // Max requests per minute

export default auth((req) => {
    const isLoggedIn = !!req.auth;
    const { nextUrl } = req;
    const response = NextResponse.next();
    const startTime = Date.now();

    // Get client IP for rate limiting
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 
               req.headers.get('x-real-ip') || 
               'unknown';
    
    const userAgent = req.headers.get('user-agent') || '';

    // Handle CORS
    const origin = req.headers.get('origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    } else if (ALLOWED_ORIGINS.includes('*')) {
      response.headers.set('Access-Control-Allow-Origin', '*');
    }
    
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Max-Age', '86400');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      return response;
    }

    // Rate limiting for API routes
    if (nextUrl.pathname.startsWith('/api/')) {
      // Create rate limit key based on IP
      const rateLimitKey = `ratelimit:${ip}:${nextUrl.pathname}`;
      
      // Use simpler rate limit check for middleware
      if (!simpleRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW * 1000)) {
        logger.warn({ msg: "Rate limit exceeded in middleware", ip, path: nextUrl.pathname });
        
        // Log the rate-limited request
        logHttpRequest(req.method, nextUrl.pathname, 429, Date.now() - startTime, ip, userAgent);
        
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { 
            status: 429,
            headers: {
              'Retry-After': String(RATE_LIMIT_WINDOW),
              'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Date.now() + RATE_LIMIT_WINDOW * 1000)
            }
          }
        );
      }

      // Add rate limit headers
      response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
      response.headers.set('X-RateLimit-Remaining', String(RATE_LIMIT_MAX - 1)); // Approximate
      response.headers.set('X-RateLimit-Reset', String(Date.now() + RATE_LIMIT_WINDOW * 1000));
    }

    // Security headers
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // Protected routes
    const isProtected =
        nextUrl.pathname.startsWith("/portfolio") ||
        nextUrl.pathname.startsWith("/posts/new");

    // Redirect to login if accessing protected route while not logged in
    if (isProtected && !isLoggedIn) {
        return NextResponse.redirect(new URL("/auth/signin?callbackUrl=" + encodeURIComponent(nextUrl.pathname), nextUrl));
    }

    // Log HTTP request after response is created
    // Note: We can't get actual status in middleware, so we log after
    // Using a response listener would be better but this is simpler
    
    return response;
});

// Simple logger for middleware
const logger = {
  warn: (data: { msg: string; ip?: string; path?: string }) => {
    console.warn(`[RATE LIMIT] ${data.msg}`, { ip: data.ip, path: data.path });
  }
};

// Updated matcher for Next.js 16 compatibility
export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    ],
};
