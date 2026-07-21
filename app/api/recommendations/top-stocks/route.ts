import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { recommendationsCache } from "@/lib/cache";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/recommendations/top-stocks — Top individual stock recommendations across all runs
 * Returns a flat list of stocks (deduplicated by symbol, latest wins) sorted by screenerCount desc.
 * Query params: limit (default 20), offset (default 0), filter (all|BUY|HOLD|SELL)
 */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || "none";

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const filter = searchParams.get("filter") || "all";

    const cacheKey = `recommendations:top-stocks:${limit}:${offset}:${filter}`;
    const cached = recommendationsCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Build filter condition
    const hasFilter = filter !== "all" && ["BUY", "HOLD", "SELL"].includes(filter);

    // Fetch all stocks from all completed runs, deduplicate by symbol (keep latest)
    const stocks = hasFilter
      ? await prisma.$queryRaw<
          Array<{
            id: string; symbol: string; runid: string; screenercount: number;
            screenerattribution: string[]; price: number; change: number;
            changepercent: number; volume: bigint | number; airecommendation: string;
            confidence: number; targetprice: number | null; stoploss: number | null;
            timehorizon: string; reasoning: string | null; riskfactors: string | null;
            aisuccess: boolean | null; rundate: Date; runstatus: string;
          }>
        >`
          SELECT DISTINCT ON (s.symbol)
            s.id, s.symbol, s."runId" as runid, s."screenerCount" as screenercount,
            s."screenerAttribution" as screenerattribution, s.price, s.change,
            s."changePercent" as changepercent, s.volume,
            s."aiRecommendation" as airecommendation, s.confidence,
            s."targetPrice" as targetprice, s."stopLoss" as stoploss,
            s."timeHorizon" as timehorizon, s.reasoning, s."riskFactors" as riskfactors,
            s."aiSuccess" as aisuccess, r."runDate" as rundate, r.status as runstatus
      FROM daily_recommendation_stocks s
      JOIN daily_recommendation_runs r ON r.id = s."runId"
      WHERE r.status IN ('completed', 'failed')
        AND r."uniqueStocks" > 0
        AND s."aiRecommendation" = ${filter}
      ORDER BY s.symbol, r."runDate" DESC
      LIMIT ${limit} OFFSET ${offset}
        `
      : await prisma.$queryRaw<
          Array<{
            id: string; symbol: string; runid: string; screenercount: number;
            screenerattribution: string[]; price: number; change: number;
            changepercent: number; volume: bigint | number; airecommendation: string;
            confidence: number; targetprice: number | null; stoploss: number | null;
            timehorizon: string; reasoning: string | null; riskfactors: string | null;
            aisuccess: boolean | null; rundate: Date; runstatus: string;
          }>
        >`
          SELECT DISTINCT ON (s.symbol)
            s.id, s.symbol, s."runId" as runid, s."screenerCount" as screenercount,
            s."screenerAttribution" as screenerattribution, s.price, s.change,
            s."changePercent" as changepercent, s.volume,
            s."aiRecommendation" as airecommendation, s.confidence,
            s."targetPrice" as targetprice, s."stopLoss" as stoploss,
            s."timeHorizon" as timehorizon, s.reasoning, s."riskFactors" as riskfactors,
            s."aiSuccess" as aisuccess, r."runDate" as rundate, r.status as runstatus
          FROM daily_recommendation_stocks s
          JOIN daily_recommendation_runs r ON r.id = s."runId"
          WHERE r.status IN ('completed', 'failed')
            AND r."uniqueStocks" > 0
          ORDER BY s.symbol, r."runDate" DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

    // Get total count for pagination
    const countResult = hasFilter
      ? await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT s.symbol) as count
          FROM daily_recommendation_stocks s
          JOIN daily_recommendation_runs r ON r.id = s."runId"
          WHERE r.status IN ('completed', 'failed')
            AND r."uniqueStocks" > 0
            AND s."aiRecommendation" = ${filter}
        `
      : await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT s.symbol) as count
          FROM daily_recommendation_stocks s
          JOIN daily_recommendation_runs r ON r.id = s."runId"
          WHERE r.status IN ('completed', 'failed')
            AND r."uniqueStocks" > 0
        `;
    const total = Number(countResult[0]?.count ?? 0);

    // Serialize BigInt and format response
    const serialized = stocks.map((s) => ({
      id: s.id,
      symbol: s.symbol,
      runId: s.runid,
      screenerCount: s.screenercount,
      screenerAttribution: s.screenerattribution,
      price: s.price,
      change: s.change,
      changePercent: s.changepercent,
      volume: s.volume != null ? Number(s.volume) : null,
      aiRecommendation: s.airecommendation,
      confidence: s.confidence,
      targetPrice: s.targetprice,
      stopLoss: s.stoploss,
      timeHorizon: s.timehorizon,
      reasoning: s.reasoning,
      riskFactors: s.riskfactors,
      aiSuccess: s.aisuccess,
      runDate: s.rundate instanceof Date ? s.rundate.toISOString() : String(s.rundate),
      runStatus: s.runstatus,
    }));

    const result = {
      success: true,
      stocks: serialized,
      total,
      limit,
      offset,
      timestamp: new Date().toISOString(),
      traceId,
    };

    // Cache for 1 hour
    recommendationsCache.set(cacheKey, result, 3600);

    logger.info({
      msg: "Top stocks fetched",
      stockCount: serialized.length,
      total,
      filter,
      traceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error({
      msg: "Failed to fetch top stocks",
      error: error instanceof Error ? error.message : String(error),
      traceId,
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch top stocks" },
      { status: 500 }
    );
  }
}
