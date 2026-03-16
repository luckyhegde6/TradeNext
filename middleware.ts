import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

// Use Node.js runtime explicitly
export const runtime = 'nodejs';

// Simple startup log
console.log('Middleware: Starting...');

const { auth } = NextAuth(authConfig);

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://tradenext6.netlify.app',
  'https://tradenext.vercel.app',
];

// Rate limit configuration - simplified for middleware
const RATE_LIMIT_WINDOW = 60; // 1 minute
const RATE_LIMIT_MAX = 100; // Max requests per minute

// Simple in-memory rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (record.count >= max) {
    return false;
  }
  
  record.count++;
  return true;
}

export default auth((req) => {
    const isLoggedIn = !!req.auth;
    const { nextUrl } = req;
    const response = NextResponse.next();

    // Get client IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 
               req.headers.get('x-real-ip') || 
               'unknown';

    // Handle CORS
    const origin = req.headers.get('origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
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
      const rateLimitKey = `ratelimit:${ip}:${nextUrl.pathname}`;
      
      if (!checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW * 1000)) {
        console.warn(`Rate limit exceeded for ${ip} on ${nextUrl.pathname}`);
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { 
            status: 429,
            headers: {
              'Retry-After': String(RATE_LIMIT_WINDOW),
              'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
              'X-RateLimit-Remaining': '0',
            }
          }
        );
      }

      response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
      response.headers.set('X-RateLimit-Remaining', String(RATE_LIMIT_MAX - 1));
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

    return response;
});

// Matcher - skip static files
export const config = {
    matcher: [
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    ],
};
