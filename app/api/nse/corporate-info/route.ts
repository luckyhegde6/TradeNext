// app/api/nse/corporate-info/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";

// Cache for 5 minutes - corporate info doesn't change frequently
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

export async function GET() {
  try {
    const data = await nseFetch(
      "/api/NextApi/apiClient",
      "?functionName=getCorporateInfo&&type=null&&noOfRecords=10&&flag=PI"
    );

    return NextResponse.json(data, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    logger.warn({ msg: "CorporateInfo: NSE fetch failed, returning empty", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ data: [], source: "unavailable" }, { headers: { "Cache-Control": CACHE_CONTROL } });
  }
}
