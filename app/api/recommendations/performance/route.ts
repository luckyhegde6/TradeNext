import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getPerformanceList,
  type PerformanceQuery,
} from "@/lib/services/recommendationPerformanceService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations/performance — Public performance list + column metadata
// Query params (all optional, Zod-validated):
//   limit, offset, status, category, recommendation, sort, order
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z
    .enum(["tracking", "target_achieved", "stop_loss_hit"])
    .optional(),
  category: z.enum(["btst", "short", "swing", "medium", "long"]).optional(),
  recommendation: z.enum(["BUY", "HOLD", "SELL"]).optional(),
  sort: z
    .enum([
      "createdAt",
      "returnPercent",
      "symbol",
      "confidence",
      "entryPrice",
      "currentPrice",
      "targetPrice",
      "stopLoss",
      "daysTracked",
      "lastCheckedAt",
    ])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || "none";

  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams)
    );

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid query parameters",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const query: PerformanceQuery = {
      ...parsed.data,
      sort: parsed.data.sort ?? "createdAt",
      order: parsed.data.order ?? "desc",
    };

    logger.info({ msg: "Fetching recommendation performance list", requestId, query });
    const data = await getPerformanceList(query);

    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    logger.error({
      msg: "Failed to fetch recommendation performance list",
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to load performance data" },
      { status: 500 }
    );
  }
}
