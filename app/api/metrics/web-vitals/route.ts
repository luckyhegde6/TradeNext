// app/api/metrics/web-vitals/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import logger from "@/lib/logger";

// Cache-Control: don't cache, this is metrics data
const CACHE_CONTROL = 'no-store, max-age=0';

interface WebVitalsPayload {
  name: string;
  value: number;
  delta: number;
  id: string;
  rating: string;
  url: string;
  timestamp: string;
}

/**
 * POST /api/metrics/web-vitals
 * 
 * Receives Core Web Vitals metrics from client-side tracking
 * Stores them in the database for analysis
 * 
 * Request body:
 * {
 *   name: "LCP" | "FID" | "CLS" | "FCP" | "TTFB",
 *   value: number,
 *   delta: number,
 *   id: string,
 *   rating: "good" | "needs-improvement" | "poor",
 *   url: string,
 *   timestamp: string
 * }
 */
export async function POST(req: Request) {
  try {
    const payload: WebVitalsPayload = await req.json();
    
    const { name, value, delta, id, rating, url, timestamp } = payload;

    // Validate required fields
    if (!name || typeof value !== "number" || !id || !url) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } }
      );
    }

    // Get basic request info
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0] : "unknown";

    // Store in database via prisma
    // Note: We'd need a WebVitals model in schema - for now we log
    logger.info({
      msg: "Web Vitals metric received",
      source: "web-vitals",
      metric: { name, value, delta, id, rating, url, timestamp, ip },
    });

    // Optionally store in ServerLog for persistence
    await prisma.serverLog.create({
      data: {
        level: "info",
        message: `Web Vitals: ${name}=${value.toFixed(2)} (${rating})`,
        source: "analytics",
        metadata: { name, value, delta, id, rating, url, timestamp, ip },
      },
    });

    return NextResponse.json(
      { success: true, message: "Metric received" },
      { status: 201, headers: { "Cache-Control": CACHE_CONTROL } }
    );
  } catch (error) {
    logger.error({ msg: "Error processing web vitals metric", error });
    return NextResponse.json(
      { error: "Failed to process metric" },
      { status: 500, headers: { "Cache-Control": CACHE_CONTROL } }
    );
  }
}

/**
 * GET /api/metrics/web-vitals
 * 
 * Returns aggregated web vitals statistics (admin only in production)
 * For now, returns mock data for testing
 */
export async function GET() {
  // In production, this would query the database for aggregated metrics
  // For now, return placeholder
  
  const stats = {
    message: "Web Vitals collection active",
    endpoints: {
      post: "Send metrics from client",
    },
    metrics: ["LCP", "FID", "CLS", "FCP", "TTFB"],
    ratings: {
      good: "< 2.5s LCP, < 100ms FID, < 0.1 CLS",
      "needs-improvement": "< 4s LCP, < 300ms FID, < 0.25 CLS",
      poor: "> 4s LCP, > 300ms FID, > 0.25 CLS",
    },
  };

  return NextResponse.json(stats, {
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}