import { NextRequest, NextResponse } from "next/server";
import { getIpoIssueDetail } from "@/lib/services/nseIpoService";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/recommendations/ipos/[symbol]/detail — per-symbol IPO detail
// (Bid Lot → shares per lot, Issue Size text, price range, registrar…) from
// NSE /api/ipo-detail — server-side proxy, cached per-symbol 24h.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const traceId = request.headers.get("x-trace-id") || "none";
  const { symbol } = await params;

  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    const result = await getIpoIssueDetail(symbol, forceRefresh);

    logger.info({
      msg: "NSE IPO detail fetched",
      symbol: symbol.toUpperCase(),
      source: result.source,
      changed: result.changed,
      traceId,
    });

    return NextResponse.json({
      success: true,
      detail: result.data,
      source: result.source,
      syncedAt: result.syncedAt ? result.syncedAt.toISOString() : null,
      changed: result.changed,
      timestamp: new Date().toISOString(),
      traceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      msg: "Failed to fetch NSE IPO detail",
      symbol: symbol.toUpperCase(),
      error: message,
      traceId,
    });
    createAuditLog({
      action: "EVENTS_FETCH_FAILED",
      resource: "ipo_detail",
      resourceId: symbol.toUpperCase(),
      path: `/api/recommendations/ipos/${symbol.toUpperCase()}/detail`,
      responseStatus: 500,
      errorMessage: message,
    }).catch(() => undefined);
    return NextResponse.json(
      { success: false, detail: null, error: "Failed to fetch IPO detail" },
      { status: 500 }
    );
  }
}