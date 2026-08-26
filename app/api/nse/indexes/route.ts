// app/api/nse/indexes/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import cache from "@/lib/cache";

const CACHE_KEY = "nse:indexes:all";
const CACHE_TTL = 300; // 5 minutes
const HTTP_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

export async function GET() {
  try {
    // Check server cache first
    const cachedData = cache.get(CACHE_KEY);
    if (cachedData) {
      return NextResponse.json(cachedData, {
        headers: { 'Cache-Control': HTTP_CACHE_CONTROL }
      });
    }

    // Call NSE API
    const data = await nseFetch("/api/NextApi/apiClient", "?functionName=getIndexData&&type=All/");

    // Cache the result
    cache.set(CACHE_KEY, data, CACHE_TTL);

    return NextResponse.json(data, {
      headers: { 'Cache-Control': HTTP_CACHE_CONTROL }
    });
  } catch (e: unknown) {
    // Serve stale cache if available
    const stale = cache.get(CACHE_KEY);
    if (stale) {
      return NextResponse.json(stale, { headers: { 'Cache-Control': HTTP_CACHE_CONTROL } });
    }
    return NextResponse.json({ data: [], source: "unavailable" }, { headers: { 'Cache-Control': HTTP_CACHE_CONTROL } });
  }
}
