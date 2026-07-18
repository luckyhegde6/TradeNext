import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { executeAIQuery, type OrchestratorInput } from "@/lib/services/ai/orchestrator";
import { getDefaultConfig, hasValidConfig } from "@/lib/services/ai/config";
import { trackAiCall, persistAiCallToDb } from "@/lib/services/ai/ai-monitoring";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/ai/query — Execute a general AI query with full safety, rate-limit, context, and result storage.
 *
 * Body: {
 *   query: string;          // User's natural language query (max 2000 chars)
 *   analysisType: string;   // "screener" | "portfolio" | "dividend" | "market" | "alert" | "general"
 *   conversationId?: string; // Continue an existing conversation
 *   model?: string;          // Override model (optional)
 *   temperature?: number;    // Override temperature (optional)
 *   useTools?: boolean;      // Enable tool calling (default: false)
 * }
 *
 * Auth: Required (any logged-in user)
 * Rate limiting: Built into orchestrator — 6 req/min for auth'd users.
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let status: "success" | "error" = "error";
  let statusAnalysisType: string = "general";

  try {
    // 1. Auth guard
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Config check
    const config = getDefaultConfig();
    if (!hasValidConfig(config)) {
      return NextResponse.json(
        { error: "AI is not configured. Admin must set OPENROUTERKEY in .env and enable AI in settings." },
        { status: 503 }
      );
    }

    // 3. Parse + validate body
    const body = await req.json();
    if (!body.query || typeof body.query !== "string" || body.query.trim().length === 0) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    if (body.query.length > 2000) {
      return NextResponse.json({ error: "Query must be under 2000 characters" }, { status: 400 });
    }

    const validTypes: readonly string[] = ["screener", "portfolio", "dividend", "market", "alert", "general"];
    statusAnalysisType = body.analysisType || "general";
    if (!validTypes.includes(statusAnalysisType)) {
      return NextResponse.json(
        { error: `Invalid analysisType. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // 4. Extract IP for rate limiting
    const forwarded = req.headers.get("x-forwarded-for");
    const ipAddress = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "127.0.0.1";

    // 5. Build orchestrator input
    const input: OrchestratorInput = {
      userId: Number(userId),
      ipAddress,
      analysisType: statusAnalysisType as any,
      query: body.query.trim(),
      conversationId: body.conversationId || undefined,
      model: body.model || undefined,
      temperature: body.temperature !== undefined ? Number(body.temperature) : undefined,
      useTools: body.useTools === true,
      metadata: {
        source: "api/ai/query",
        userAgent: req.headers.get("user-agent") || undefined,
      },
    };

    // 6. Execute
    const result = await executeAIQuery(input);
    status = result.success ? "success" : "error";

    // 7. Return with status based on success
    if (!result.success) {
      const statusCode =
        result.error?.code === "CONFIG" ? 503 :
        result.error?.code === "SAFETY" ? 400 :
        result.error?.code === "RATE_LIMIT" ? 429 : 500;

      return NextResponse.json(result, { status: statusCode });
    }

    return NextResponse.json(result);
  } catch (err) {
    logger.error({ msg: "AI query API failed", error: err });
    return NextResponse.json(
      { error: "Failed to process AI query. Please try again." },
      { status: 500 }
    );
  } finally {
    trackAiCall({
      timestamp: new Date().toISOString(),
      action: statusAnalysisType,
      model: getDefaultConfig().model || "openrouter/free",
      status,
      tokensUsed: 0,
      responseTimeMs: Date.now() - startTime,
    });
    persistAiCallToDb({
      timestamp: new Date().toISOString(),
      action: statusAnalysisType,
      model: getDefaultConfig().model || "openrouter/free",
      status,
      tokensUsed: 0,
      responseTimeMs: Date.now() - startTime,
    }).catch(() => {});
  }
}
