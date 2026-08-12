import { NextRequest, NextResponse } from "next/server";
import { fetchExpiries } from "@/lib/services/nse-fo-api";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/fo/expiries — Fetch available F&O expiry dates for a symbol
 * Query: ?symbol=NIFTY (defaults to NIFTY)
 * Public market data — no auth required.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "NIFTY").toUpperCase();

    const expiries = await fetchExpiries(symbol);
    return NextResponse.json(expiries);
  } catch (err) {
    logger.error({ msg: "Failed to fetch F&O expiries", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
