import { NextResponse } from "next/server";
import logger from "@/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
    const startTime = Date.now();
    const { jobId } = await params;

    try {
        logger.info({ msg: 'Checking job status', jobId });

        // Background job processing is disabled - Redis not configured
        return NextResponse.json({
            jobId,
            status: 'disabled',
            message: 'Background job processing is disabled - Redis not configured',
            progress: 0,
            duration: Date.now() - startTime
        });
    } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ msg: 'Failed to get job status', jobId, error: errorMessage, duration });
        return NextResponse.json({ error: 'Failed to get job status' }, { status: 500 });
    }
}
