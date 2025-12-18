import { NextResponse } from "next/server";
import { getIndexHeatmap } from "@/lib/index-service";
import { z } from "zod";
import logger from "@/lib/logger";

const heatmapQuerySchema = z.object({
    page: z.string().optional().transform(val => val ? parseInt(val) : 1),
    limit: z.string().optional().transform(val => val ? Math.min(parseInt(val), 200) : 50), // Max 200 items per page
});

export async function GET(req: Request, { params }: { params: Promise<{ index: string }> }) {
    const startTime = Date.now();
    const { index } = await params;
    const indexName = decodeURIComponent(index);

    try {
        const url = new URL(req.url);
        const queryValidation = heatmapQuerySchema.safeParse({
            page: url.searchParams.get("page"),
            limit: url.searchParams.get("limit"),
        });

        if (!queryValidation.success) {
            logger.warn({ msg: 'Invalid heatmap query parameters', indexName, errors: queryValidation.error.errors });
            return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
        }

        const { page, limit } = queryValidation.data;

        logger.info({ msg: 'Fetching heatmap data', indexName, page, limit });
        const data = await getIndexHeatmap(indexName, page, limit);

        const duration = Date.now() - startTime;
        logger.info({
            msg: 'Heatmap data fetched successfully',
            indexName,
            page,
            limit,
            itemCount: data.items.length,
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
