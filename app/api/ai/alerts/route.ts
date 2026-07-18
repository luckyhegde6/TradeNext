import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { analyzeAlerts } from "@/lib/services/ai/alert-agent";
import { getDefaultConfig, hasValidConfig } from "@/lib/services/ai/config";
import { trackAiCall, persistAiCallToDb } from "@/lib/services/ai/ai-monitoring";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/ai/alerts — Analyze triggered alerts with AI
 * Body: { alerts: AlertEvent[] }
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
        { error: "AI is not configured. Admin must enable AI in settings." },
        { status: 503 }
      );
    }

    const body = await req.json();
    if (!body.alerts || !Array.isArray(body.alerts)) {
      return NextResponse.json(
        { error: "alerts array is required" },
        { status: 400 }
      );
    }

    if (body.alerts.length === 0) {
      status = "success";
      return NextResponse.json({
        success: true,
        analysis: "No alerts to analyze.",
        executionTimeMs: 0,
      });
    }

    if (body.alerts.length > 20) {
      return NextResponse.json(
        { error: "Maximum 20 alerts per analysis" },
        { status: 400 }
      );
    }

    const result = await analyzeAlerts(body.alerts, config);
    status = "success";
    return NextResponse.json(result);
  } catch (err) {
    logger.error({ msg: "AI alert analysis API failed", error: err });
    return NextResponse.json(
      { error: "Failed to analyze alerts. Please try again." },
      { status: 500 }
    );
  } finally {
    const responseTimeMs = Date.now() - startTime;
    const entry = {
      timestamp: new Date().toISOString(),
      action: "alerts" as const,
      model: (getDefaultConfig().model) || "openrouter/free",
      status,
      tokensUsed: 0,
      responseTimeMs,
    };
    trackAiCall(entry);
    persistAiCallToDb(entry).catch(() => {});
  }
}
