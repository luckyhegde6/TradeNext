// app/api/nse/losers/route.ts
import { NextResponse } from "next/server";
import { nseFetchSWR } from "@/lib/nse-swr";
import { normalizeLosers } from "@/lib/nse/normalize";
import logger from "@/lib/logger";

export async function GET() {
  try {
    const { data, stale } = await nseFetchSWR(
      "nse:losers",
      "/api/live-analysis-variations",
      "?index=loosers",
      {
        tier: "hot",
        ttl: 20,
        swrTtl: 20,
      }
    );

    return NextResponse.json(
      { data: normalizeLosers(data), stale },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logger.warn({ msg: "Losers: NSE fetch failed, returning empty", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ data: [], stale: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
