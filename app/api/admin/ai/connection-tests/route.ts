import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";
import {
  runAiConnectionTest,
  getLastAiConnectionTests,
  AI_FALLBACK_MODELS,
} from "@/lib/services/ai/connectionTestService";

export const runtime = "nodejs";

/**
 * GET /api/admin/ai/connection-tests?limit=10
 * Last AI connection-test records (persisted via trackAiCall — survives
 * serverless cold starts). Each entry carries the probe status
 * ("success" | "error"), model, response time and error.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "10", 10) || 10, 1), 100);
    const entries = await getLastAiConnectionTests(limit);

    return NextResponse.json({ success: true, entries, fallbackModels: AI_FALLBACK_MODELS });
  } catch (err) {
    logger.error({ msg: "GET AI connection tests failed", error: err });
    return NextResponse.json({ success: false, error: "Failed to load connection tests" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ai/connection-tests — run the connection test now.
 * Probes the configured model, then the fallback routes on failure; returns
 * the full report (status, primary, fallbacks, recommendedModel).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const start = Date.now();
    const report = await runAiConnectionTest();
    const elapsed = Date.now() - start;

    logger.info({
      msg: "Admin ran AI connection test",
      status: report.status,
      configuredModel: report.configuredModel,
      recommendedModel: report.recommendedModel,
      elapsed,
    });

    return NextResponse.json({ success: true, report });
  } catch (err) {
    logger.error({ msg: "POST AI connection test failed", error: err });
    return NextResponse.json({ success: false, error: "Connection test failed" }, { status: 500 });
  }
}
