import { NextResponse } from "next/server";
import { getIndexHeatmap } from "@/lib/index-service";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const data = await getIndexHeatmap(indexName);
        return NextResponse.json(data);
    } catch (e) {
        console.error("Heatmap API Error:", e);
        return NextResponse.json({ error: "Failed to fetch heatmap" }, { status: 502 });
    }
}
