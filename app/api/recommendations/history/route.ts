import { NextRequest, NextResponse } from "next/server";
import { getRecommendationHistory } from "@/lib/services/dailyRecommendationService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations/history — Get historical recommendation runs with stocks
export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || "none";

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "30"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    const runs = await getRecommendationHistory({ limit, offset });

    logger.info({
      msg: "Recommendation history fetched",
      runCount: runs.length,
      traceId,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return NextResponse.json({
      success: true,
      runs: runs.map((r: any) => ({
        id: r.id,
        runDate: r.runDate instanceof Date ? r.runDate.toISOString() : String(r.runDate),
        status: r.status,
        totalScreeners: r.totalScreeners,
        uniqueStocks: r.uniqueStocks,
        aiProcessed: r.aiProcessed,
        executionTimeMs: r.executionTimeMs,
        stockCount: r.uniqueStocks ?? r.totalStocks,
        stocks: r.stocks.map((s: any) => ({
          id: s.id,
          symbol: s.symbol,
          price: s.price,
          change: s.change,
          changePercent: s.changePercent,
          volume: Number(s.volume ?? 0),
          screenerAttribution: s.screenerAttribution,
          screenerCount: s.screenerCount,
          aiRecommendation: s.aiRecommendation,
          confidence: s.confidence,
          targetPrice: s.targetPrice,
          stopLoss: s.stopLoss,
          timeHorizon: s.timeHorizon,
          reasoning: s.reasoning,
          riskFactors: s.riskFactors,
          aiSuccess: s.aiSuccess,
        })),
      })),
      timestamp: new Date().toISOString(),
      traceId,
    });
  } catch (error) {
    logger.error({
      msg: "Failed to fetch recommendation history",
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
