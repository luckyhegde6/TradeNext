// app/api/nse/index/[index]/chart/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getIndexChartData } from "@/lib/index-service";
import logger from "@/lib/logger";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ index: string }> }
) {
    const { index } = await params;
    const url = new URL(request.url);
    const timeframe = url.searchParams.get('timeframe') || '1D';
    const decodedIndex = decodeURIComponent(index);

    try {
        const data = await getIndexChartData(decodedIndex, timeframe);
        if (!data) {
            return NextResponse.json(null);
        }
        return NextResponse.json(data);
    } catch (e) {
        logger.warn({ msg: "Index chart: fetch failed", indexName: decodedIndex, timeframe, error: e instanceof Error ? e.message : String(e) });
        return NextResponse.json(null);
    }
}
