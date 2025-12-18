// app/api/nse/indexes/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch, redis } from "@/lib/nse-client";

const CACHE_KEY = "nse:indexes:all";

export async function GET() {
  try {
    // check Redis cache first (only if Redis is available)
    if (redis) {
      try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) return NextResponse.json(JSON.parse(cached));
      } catch (redisError) {
        console.warn("Redis get error (continuing without cache):", redisError);
      }
    }

    // call NSE
    const data = await nseFetch("/api/NextApi/apiClient", "?functionName=getIndexData&&type=All/");

    // cache for 2 minutes (only if Redis is available)
    if (redis) {
      try {
        await redis.set(CACHE_KEY, JSON.stringify(data), "EX", 120);
      } catch (redisError) {
        console.warn("Redis set error (continuing without cache):", redisError);
      }
    }

    return NextResponse.json(data);
  } catch (e: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.error("nse:indexes error", (e as any)?.message ?? e);
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
