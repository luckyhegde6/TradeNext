import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getIpoAnalysis } from "@/lib/services/ipoAnalysisService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations/ipos/[symbol]/analysis?refresh=1
// AI IPO analysis (14-step equity-research brief), auth-gated.
// Cache-first: repeated hits within 12h reuse the SAME stored output
// (no duplicate model calls). `refresh=1` forces a fresh generation.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const traceId = request.headers.get("x-trace-id") || "none";
  const { symbol } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Sign in to run AI IPO analysis" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    const result = await getIpoAnalysis(symbol, { forceRefresh });

    logger.info({
      msg: "IPO analysis served",
      symbol: symbol.toUpperCase(),
      source: result.source,
      forceRefresh,
      traceId,
    });

    return NextResponse.json({
      success: true,
      analysis: {
        symbol: result.symbol,
        companyName: result.companyName,
        content: result.content,
        verdict: result.verdict,
        recommendation: result.recommendation,
        generatedAt: result.generatedAt,
        // v2 structured report (absent for legacy markdown rows).
        report: result.report ?? null,
      },
      source: result.source,
      cachedAt: result.cachedAt,
      traceId,
    });
  } catch (error) {
    logger.error({
      msg: "Failed to generate IPO analysis",
      symbol: symbol.toUpperCase(),
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("AI is not configured") ? 503 : 502;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}