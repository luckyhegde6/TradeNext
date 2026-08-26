// app/api/nse/gainers/route.ts
import { NextResponse } from "next/server";
import { nseFetchSWR } from "@/lib/nse-swr";
import { normalizeGainers } from "@/lib/nse/normalize";
import logger from "@/lib/logger";

export async function GET() {
  try {
    const { data, stale } = await nseFetchSWR(
      "nse:gainers",
      "/api/live-analysis-variations",
      "?index=gainers",
      {
        tier: "hot",
        ttl: 20,
        swrTtl: 20,
      }
    );

    return NextResponse.json(
      { data: normalizeGainers(data), stale },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    logger.warn({ msg: "Gainers: NSE fetch failed, returning empty", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ data: [], stale: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
