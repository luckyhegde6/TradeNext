// app/api/nse/gainers/route.ts
import { NextResponse } from "next/server";
import { nseFetchSWR } from "@/lib/nse-swr";
import { normalizeGainers } from "@/lib/nse/normalize";

export async function GET() {
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
}
