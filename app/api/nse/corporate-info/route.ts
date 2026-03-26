// app/api/nse/corporate-info/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";

// Cache for 5 minutes - corporate info doesn't change frequently
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

export async function GET() {
  const data = await nseFetch(
    "/api/NextApi/apiClient",
    "?functionName=getCorporateInfo&&type=null&&noOfRecords=10&&flag=PI"
  );

  return NextResponse.json(data, { headers: { "Cache-Control": CACHE_CONTROL } });
}
