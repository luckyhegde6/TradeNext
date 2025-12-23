// app/api/nse/losers/route.ts
import { NextResponse } from "next/server";
import { nseFetchSWR } from "@/lib/nse-swr";
import { normalizeLosers } from "@/lib/nse/normalize";

export async function GET() {
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
}
