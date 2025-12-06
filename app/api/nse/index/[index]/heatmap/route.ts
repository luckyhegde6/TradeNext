// app/api/nse/index/[index]/heatmap/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import cache from "@/lib/cache";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);
    const key = `nse:index:${indexName}:heatmap`;

    try {
        const cached = cache.get(key);
        if (cached) return NextResponse.json(cached);

        // Heatmap: indexTrackerApi?functionName=getIndicesHeatMap&&index=NIFTY%2050
        const qs = `?functionName=getIndicesHeatMap&&index=${encodeURIComponent(indexName)}`;
        const data = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs);

        cache.set(key, data);
        return NextResponse.json(data);
    } catch (e) {
        console.error(`Error fetching heatmap for ${indexName}:`, e);
        return NextResponse.json({ error: "failed to fetch heatmap" }, { status: 502 });
    }
}
