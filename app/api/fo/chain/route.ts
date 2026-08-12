import { NextRequest, NextResponse } from "next/server";
import { fetchOptionChain } from "@/lib/services/nse-fo-api";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/fo/chain — Fetch NSE option chain for a symbol (option-chain-v3)
 * Query: ?symbol=NIFTY (defaults to NIFTY) &expiry=2026-08-18 (optional ISO date — server-side filter)
 * Public market data — no auth required (consistent with other NSE data endpoints).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "NIFTY").toUpperCase();
    const expiry = searchParams.get("expiry") || undefined;

    const chain = await fetchOptionChain(symbol, expiry);
    return NextResponse.json(chain);
  } catch (err) {
    logger.error({ msg: "Failed to fetch F&O option chain", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
