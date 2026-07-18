import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runScreenerAgent } from "@/lib/services/ai/screener-agent";
import { getDefaultConfig, hasValidConfig } from "@/lib/services/ai/config";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/ai/screener — Run AI-powered stock screener analysis
 * Body: { query: string }
 */
export async function POST(req: NextRequest) {
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

    const result = await runScreenerAgent(body.query.trim(), config);
    return NextResponse.json(result);
  } catch (err) {
    logger.error({ msg: "AI screener API failed", error: err });
    return NextResponse.json(
      { error: "Failed to run AI analysis. Please try again." },
      { status: 500 }
    );
  }
}
