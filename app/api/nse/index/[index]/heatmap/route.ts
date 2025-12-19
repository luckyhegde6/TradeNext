import { NextResponse } from "next/server";
import { getIndexHeatmap } from "@/lib/index-service";
import logger from "@/lib/logger";

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const startTime = Date.now();
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        logger.info({ msg: 'Fetching heatmap data', indexName });
        const data = await getIndexHeatmap(indexName);

        const duration = Date.now() - startTime;
        logger.info({
            msg: 'Heatmap data fetched successfully',
            indexName,
            count: data.length,
            duration
        });

        return NextResponse.json(data);
    } catch (e) {
        const duration = Date.now() - startTime;
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger.error({ msg: 'Heatmap API Error', indexName, error: errorMessage, duration });
        return NextResponse.json({ error: "Failed to fetch heatmap" }, { status: 502 });
    }
}
