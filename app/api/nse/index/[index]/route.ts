// app/api/nse/index/[index]/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getIndexDetails } from "@/lib/index-service";
import logger from "@/lib/logger";

// Cache for 1 minute - index data updates regularly
const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=180';

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const data = await getIndexDetails(indexName);
        return NextResponse.json(data, {
            headers: { 'Cache-Control': CACHE_CONTROL }
        });
    } catch (e) {
        logger.warn({ msg: "Index details: fetch failed", indexName, error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json(null);
    }
}
