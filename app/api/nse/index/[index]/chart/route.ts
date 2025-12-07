// app/api/nse/index/[index]/chart/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getIndexChartData } from "@/lib/index-service";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        // Use the centralized service which handles DB -> Cache -> API
        const data = await getIndexChartData(indexName);
        return NextResponse.json(data);
    } catch (e) {
        console.error(`Error fetching chart for ${indexName}:`, e);
        return NextResponse.json({ error: "failed to fetch chart" }, { status: 502 });
    }
}
