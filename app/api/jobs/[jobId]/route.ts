import { NextResponse } from "next/server";
import { ingestionQueue, marketDataQueue } from "@/worker/ingestion-worker";
import logger from "@/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
    const startTime = Date.now();
    const { jobId } = await params;

    try {
        logger.info({ msg: 'Checking job status', jobId });

        // Check both queues for the job
        let job = null;

        if (ingestionQueue) {
            try {
                job = await ingestionQueue.getJob(jobId);
            } catch {
                // Job not in ingestion queue
            }
        }

        if (!job && marketDataQueue) {
            try {
                job = await marketDataQueue.getJob(jobId);
            } catch {
                // Job not in market data queue
            }
        }

        if (!job) {
            logger.warn({ msg: 'Job not found', jobId });
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        const state = await job.getState();
        const progress = job.progress;
        const finishedOn = job.finishedOn;
        const processedOn = job.processedOn;
        const failedReason = job.failedReason;

        const jobStatus = {
            id: job.id,
            name: job.name,
            data: job.data,
            opts: job.opts,
            progress,
            attemptsMade: job.attemptsMade,
            finishedOn,
            processedOn,
            failedReason,
            state,
            returnvalue: job.returnvalue,
            timestamp: new Date().toISOString()
        };

        const duration = Date.now() - startTime;
        logger.info({ msg: 'Job status retrieved', jobId, state, duration });

        return NextResponse.json(jobStatus);
    } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ msg: 'Failed to get job status', jobId, error: errorMessage, duration });
        return NextResponse.json({ error: 'Failed to get job status' }, { status: 500 });
    }
}
