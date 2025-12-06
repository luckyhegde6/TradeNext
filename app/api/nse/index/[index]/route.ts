// app/api/nse/index/[index]/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import cache from "@/lib/cache";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);
    const key = `nse:index:${indexName}:details`;

    try {
        const cached = cache.get(key);
        if (cached) return NextResponse.json(cached);

        // Fetch Details: indexTrackerApi?functionName=getIndexData&&index=NIFTY%2050
        // Note: User provided example for #4 was getIndexData&&index=NIFTY%2050
        const qs = `?functionName=getIndexData&&index=${encodeURIComponent(indexName)}`;
        const data = await nseFetch("/api/NextApi/apiClient/indexTrackerApi", qs);

        cache.set(key, data);
        return NextResponse.json(data);
    } catch (e) {
        console.error(`Error fetching details for ${indexName}:`, e);
        return NextResponse.json({ error: "failed to fetch details" }, { status: 502 });
    }
}
