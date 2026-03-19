// Minimal proxy without NextAuth - for Netlify compatibility
import { NextResponse, type NextRequest } from "next/server";

console.log('Proxy: Starting (minimal - no NextAuth)...');

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://tradenext6.netlify.app',
  'https://tradenext.vercel.app',
];

// Simple rate limiting (in-memory)
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

export function proxy(request: NextRequest) {
  const nextUrl = request.nextUrl;
  const response = NextResponse.next();

  // Get client IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
    request.headers.get('x-real-ip') ||
    'unknown';

  // Handle CORS
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Max-Age', '86400');

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return response;
  }

  // Rate limiting for API routes
  if (nextUrl.pathname.startsWith('/api/')) {
    const rateLimitKey = `ratelimit:${ip}:${nextUrl.pathname}`;

    if (!checkRateLimit(rateLimitKey, 100, 60000)) {
      console.warn(`Rate limit exceeded for ${ip}`);
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
    }
  }

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');

  return response;
}

// Matcher - skip static files
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
