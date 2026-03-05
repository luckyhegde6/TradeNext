// app/api/nse/index/[index]/chart/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getIndexChartData } from "@/lib/index-service";

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
            return NextResponse.json({ error: 'Failed to fetch chart data' }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (e) {
        console.error(`Error fetching chart for ${decodedIndex} with timeframe ${timeframe}:`, e);
        return NextResponse.json({ error: "failed to fetch chart" }, { status: 502 });
    }
}
