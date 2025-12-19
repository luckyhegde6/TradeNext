// app/api/nse/indexes/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import cache from "@/lib/cache";

const CACHE_KEY = "nse:indexes:all";
const CACHE_TTL = 300; // 5 minutes

export async function GET() {
  try {
    // Check server cache first
    const cachedData = cache.get(CACHE_KEY);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    // Call NSE API
    const data = await nseFetch("/api/NextApi/apiClient", "?functionName=getIndexData&&type=All/");

    // Cache the result
    cache.set(CACHE_KEY, data, CACHE_TTL);

    return NextResponse.json(data);
  } catch (e: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.error("nse:indexes error", (e as any)?.message ?? e);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
