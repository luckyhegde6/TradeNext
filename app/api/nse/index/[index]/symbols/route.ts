// app/api/nse/index/[index]/symbols/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import cache from "@/lib/cache";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
  const { index } = await params;
  const indexName = decodeURIComponent(index);
  const cacheKey = `nse:index:${indexName}:symbols`;
  const CACHE_TTL = 300; // 5 minutes

  try {
    // Check server cache first
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    const qs = `?functionName=getAllIndicesSymbols&&index=${encodeURIComponent(indexName)}`;
    const data = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs);

    // Cache the result
    cache.set(cacheKey, data, CACHE_TTL);

    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
