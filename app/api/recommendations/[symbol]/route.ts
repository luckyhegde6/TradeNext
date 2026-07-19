import { NextResponse } from "next/server";
import { getStockRecommendationDetail } from "@/lib/services/dailyRecommendationService";

export const runtime = "nodejs";

// GET /api/recommendations/[symbol] — Get detail for a specific stock
export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const { tracker, history } = await getStockRecommendationDetail(symbol.toUpperCase());

    if (!tracker) {
      return NextResponse.json({ success: false, error: "No recommendation found for this symbol" }, { status: 404 });
    }

    // tracker is fetched with include: { statusHistory: true } but the return type
    // doesn't reflect the include. Cast to access statusHistory at runtime.
    const trackerWithHistory = tracker as typeof tracker & {
      statusHistory?: { previousStatus: string; newStatus: string; triggerSource: string; createdAt: Date }[];
    };

    return NextResponse.json({
      success: true,
      tracker: {
        symbol: tracker.symbol,
        status: tracker.status,
        entryPrice: tracker.entryPrice,
        currentPrice: tracker.currentPrice,
        targetPrice: tracker.targetPrice,
        stopLoss: tracker.stopLoss,
        timeHorizon: tracker.timeHorizon,
        confidence: tracker.confidence,
        aiRecommendation: tracker.aiRecommendation,
        reasoning: tracker.reasoning,
        riskFactors: tracker.riskFactors,
        screenerAttribution: tracker.screenerAttribution,
        createdAt: tracker.createdAt,
      },
      history: history.map(h => ({
        date: h.createdAt,
        price: h.price,
        aiRecommendation: h.aiRecommendation,
        confidence: h.confidence,
        screenerCount: h.screenerCount,
      })),
      statusHistory: trackerWithHistory.statusHistory?.map((sh) => ({
        previousStatus: sh.previousStatus,
        newStatus: sh.newStatus,
        triggerSource: sh.triggerSource,
        createdAt: sh.createdAt,
      })) || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Failed to fetch stock detail" }, { status: 500 });
  }
}
