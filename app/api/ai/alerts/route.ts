import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { analyzeAlerts } from "@/lib/services/ai/alert-agent";
import { getDefaultConfig, hasValidConfig } from "@/lib/services/ai/config";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/ai/alerts — Analyze triggered alerts with AI
 * Body: { alerts: AlertEvent[] }
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
    return NextResponse.json(result);
  } catch (err) {
    logger.error({ msg: "AI alert analysis API failed", error: err });
    return NextResponse.json(
      { error: "Failed to analyze alerts. Please try again." },
      { status: 500 }
    );
  }
}
