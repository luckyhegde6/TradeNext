import { NextRequest, NextResponse } from "next/server";
import { getLatestRecommendations } from "@/lib/services/dailyRecommendationService";
import { recommendationsCache } from "@/lib/cache";
import { isDbUnavailableError } from "@/lib/db-utils";
import { getSqliteFallback } from "@/lib/sqlite";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations — Get latest daily recommendations
export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || "none";
  
  try {
    logger.info({ msg: "Fetching latest recommendations", requestId });
    const { run, stocks, latestRun } = await getLatestRecommendations();

    logger.info({
      msg: "Recommendations fetched",
      stockCount: stocks.length,
      runId: run?.id,
    });

    // Serialize run safely — pick only scalar fields (avoid BigInt in nested stocks)
    const serializedRun = run
      ? {
          id: run.id,
          runDate: run.runDate instanceof Date ? run.runDate.toISOString() : String(run.runDate),
          status: run.status,
          totalScreeners: run.totalScreeners,
          uniqueStocks: run.uniqueStocks,
          aiProcessed: run.aiProcessed,
          executionTimeMs: run.executionTimeMs,
        }
      : null;

    // Newest run row (may be a v3.11.1 AI-unavailable failure with zero picks —
    // in that case `run` above is the last good run and the UI shows a notice).
    const serializedLatestRun = latestRun
      ? {
          id: latestRun.id,
          runDate:
            latestRun.runDate instanceof Date
              ? latestRun.runDate.toISOString()
              : String(latestRun.runDate),
          status: latestRun.status,
        }
      : null;

    // Serialize stocks — convert BigInt, ensure plain objects
    const serializedStocks = stocks.map((s) => ({
      symbol: s.symbol,
      price: s.price,
      change: s.change,
      changePercent: s.changePercent,
      volume: typeof s.volume === "bigint" ? Number(s.volume) : (s.volume ?? 0),
      screenerAttribution: s.screenerAttribution,
      screenerCount: s.screenerCount,
      aiRecommendation: s.aiRecommendation ?? "HOLD",
      confidence: s.confidence ?? 50,
      targetPrice: s.targetPrice ?? null,
      stopLoss: s.stopLoss ?? null,
      timeHorizon: s.timeHorizon ?? "medium",
      reasoning: s.reasoning ?? null,
      riskFactors: s.riskFactors ?? null,
      // Tracker status for highlighting
      trackerStatus: s.tracker?.status ?? "active",
      entryPrice: s.tracker?.entryPrice ?? s.price,
      currentPrice: s.tracker?.currentPrice ?? s.price,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    }));

    const responseBody = {
      success: true,
      run: serializedRun,
      latestRun: serializedLatestRun,
      stocks: serializedStocks,
      timestamp: new Date().toISOString(),
    };

    // Cache for SQLite fallback + in-memory
    recommendationsCache.set("recommendations:latest", responseBody, 600);

    // Background: sync to SQLite for future DB-outage fallback
    const sqlite = getSqliteFallback();
    if (sqlite?.isReady()) {
      sqlite.syncFromPrisma().catch(() => {}); // non-blocking
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    // --- SQLite fallback ---
    const sqlite = getSqliteFallback();
    if (sqlite?.isReady()) {
      try {
        const cached = sqlite.getLatestRecommendations();
        if (cached) {
          logger.warn({ msg: "Recommendations: DB unavailable — serving SQLite backup" });
          return NextResponse.json(cached);
        }
      } catch {
        // SQLite fallback itself failed — fall through to memory cache
      }
    }

    // --- Memory cache fallback (covers both DB + network errors) ---
    if (isDbUnavailableError(error)) {
      const memCached = recommendationsCache.get("recommendations:latest");
      if (memCached) {
        logger.warn({ msg: "Recommendations: DB unavailable — serving memory cache" });
        return NextResponse.json(memCached);
      }
    }

    logger.error({
      msg: "Failed to fetch recommendations",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch recommendations" },
      { status: 500 }
    );
  }
}
