// app/api/nse/index/[index]/chart/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import cache from "@/lib/cache";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);
    const key = `nse:index:${indexName}:chart:1D`;

    try {
        // 1. Check in-memory cache
        const cached = cache.get(key);
        if (cached) {
            return NextResponse.json(cached);
        }

        // 2. Fetch from NSE
        // Example: indexTrackerApi?functionName=getIndexChart&&index=NIFTY%2050&flag=1D
        const qs = `?functionName=getIndexChart&&index=${encodeURIComponent(indexName)}&flag=1D`;
        const data = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs);

        // 3. Cache it (TTL 3600s = 1 hour)
        cache.set(key, data, 3600);

        return NextResponse.json(data);
    } catch (e) {
        console.error(`Error fetching chart for ${indexName}:`, e);
        return NextResponse.json({ error: "failed to fetch chart" }, { status: 502 });
    }
}
