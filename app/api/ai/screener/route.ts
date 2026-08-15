import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runScreenerAgent } from "@/lib/services/ai/screener-agent";
import { getDefaultConfig, hasValidConfig } from "@/lib/services/ai/config";
import {
  checkRateLimit,
  recordViolation,
  getRateLimitHeaders,
} from "@/lib/services/ai/rateLimit";
import { trackAiCall } from "@/lib/services/ai/ai-monitoring";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/ai/screener — Run AI-powered stock screener analysis
 * Body: { query: string }
 *
 * Rate limited: 6 req/min for auth'd users, 2 req/min for anonymous.
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let status: "success" | "error" = "error";

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = getDefaultConfig();
    if (!hasValidConfig(config)) {
      return NextResponse.json(
        { error: "AI is not configured. Admin must set OPENROUTERKEY in .env and enable AI in settings." },
        { status: 503 }
      );
    }

    const body = await req.json();
    if (!body.query || typeof body.query !== "string" || body.query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    if (body.query.length > 2000) {
      return NextResponse.json(
        { error: "Query must be under 2000 characters" },
        { status: 400 }
      );
    }

    // Rate limiting
    const forwarded = req.headers.get("x-forwarded-for");
    const ipAddress = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "127.0.0.1";
    const estimatedTokens = body.query.length / 4; // rough estimate

    const rateResult = await checkRateLimit(Number(session.user.id), ipAddress, estimatedTokens);
    const rateLimitHeaders = getRateLimitHeaders(rateResult);

    if (!rateResult.allowed) {
      await recordViolation(Number(session.user.id), ipAddress);
      return NextResponse.json(
        {
          error: rateResult.reason || "Rate limit exceeded. Please wait before trying again.",
          retryAfter: rateResult.retryAfter,
          cooldownUntil: rateResult.cooldownUntil,
        },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    const result = await runScreenerAgent(body.query.trim(), config);
    status = result.success ? "success" : "error";
    return NextResponse.json(result, { headers: rateLimitHeaders });
  } catch (err) {
    logger.error({ msg: "AI screener API failed", error: err });
    return NextResponse.json(
      { error: "Failed to run AI analysis. Please try again." },
      { status: 500 }
    );
  } finally {
    const entry = {
      timestamp: new Date().toISOString(),
      action: "screener" as const,
      model: getDefaultConfig().model || "openrouter/free",
      status,
      tokensUsed: 0,
      responseTimeMs: Date.now() - startTime,
    };
    // Await persistence so the DB write completes before the response returns
    // — otherwise AI calls would be lost on every request.
    await trackAiCall(entry);
  }
}
