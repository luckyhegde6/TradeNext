import { NextResponse } from "next/server";

export const runtime = "nodejs";

// List of env vars to exclude (secrets, passwords, keys)
const EXCLUDED_VARS = [
  "DATABASE_URL",
  "DATABASE_REMOTE", 
  "ACCELERATE_URL",
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "ADMIN_PASSWORD",
  "DEMO_PASSWORD",
  "password",
  "secret",
  "key",
  "token",
  "PRIVATE_",
  "PASSWORD",
];

// List of safe env vars to include
const SAFE_VARS = [
  "ENVIRONMENT",
  "USE_REMOTE_DB",
  "NODE_ENV",
  "NEXT_PUBLIC_APP_URL",
  "NETLIFY",
  "VERCEL",
  "VERCEL_URL",
  "AWS_REGION",
  "LOG_LEVEL",
];

function isSafeVar(key: string): boolean {
  const lowerKey = key.toLowerCase();
  
  // Check if it's a known safe var
  if (SAFE_VARS.some(v => key === v || key.startsWith("NEXT_PUBLIC_"))) {
    return true;
  }
  
  // Check if it matches any excluded patterns
  if (EXCLUDED_VARS.some(excluded => lowerKey.includes(excluded.toLowerCase()))) {
    return false;
  }
  
  // Allow vars that start with safe prefixes
  if (key.startsWith("NEXT_PUBLIC_")) {
    return true;
  }
  
  return false;
}

function sanitizeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(process.env)) {
    if (isSafeVar(key)) {
      // For boolean-like values, just show them
      if (value === "true" || value === "false") {
        env[key] = value;
      } else if (value !== undefined && value !== "") {
        // Show first 50 chars for other values to identify them
        env[key] = value.length > 50 ? value.substring(0, 50) + "..." : value;
      }
    }
  }
  
  return env;
}

export async function GET() {
  const env = sanitizeEnv();
  
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime?.() || "unknown",
    memory: process.memoryUsage?.() ? {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    } : undefined,
    nodeVersion: process.version,
    platform: process.platform,
    environment: {
      environment: process.env.ENVIRONMENT || "production",
      useRemoteDb: process.env.USE_REMOTE_DB === "true",
      nodeEnv: process.env.NODE_ENV || "production",
      isNetlify: !!process.env.NETLIFY,
      isVercel: !!process.env.VERCEL,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
    env: env,
  };
  
  return NextResponse.json(health, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
