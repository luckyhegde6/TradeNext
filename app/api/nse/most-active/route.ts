// app/api/nse/most-active/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import { normalizeMostActive } from "@/lib/nse/normalize";

export async function GET() {
  const data = await nseFetch("https://www.nseindia.com/api/live-analysis-most-active-securities?index=value");
  const normalized = normalizeMostActive(data);
  return NextResponse.json(
    { data: normalized, timestamp: data.timestamp },
    { headers: { "Cache-Control": "no-store" } }
  );
}
