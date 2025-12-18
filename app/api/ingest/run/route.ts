// app/api/ingest/run/route.ts
import { NextResponse } from 'next/server';
import { runIngestion } from '@/lib/services/ingestService';
import logger from '@/lib/logger';
import { z } from 'zod';
import { queueManager } from '@/worker/ingestion-worker';

const ingestRequestSchema = z.object({
    csvPath: z.string().optional(),
    sync: z.boolean().optional(), // Force synchronous processing
});

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const startTime = Date.now();

    try {
        logger.info({ msg: 'Starting ingestion request' });

        // Validate request body
        const body = await req.json().catch(() => ({}));
        const validationResult = ingestRequestSchema.safeParse(body);

        if (!validationResult.success) {
            logger.warn({ msg: 'Invalid ingestion request', errors: validationResult.error.errors });
            return NextResponse.json({ error: 'Invalid request body', details: validationResult.error.errors }, { status: 400 });
        }

        const { csvPath, sync = false } = validationResult.data;

        // Check if background processing is available and not forced to sync
        if (queueManager && !sync) {
            try {
                logger.info({ msg: 'Queueing ingestion job for background processing', csvPath });
                const job = await queueManager.addCsvIngestion(csvPath);
                const duration = Date.now() - startTime;

                logger.info({ msg: 'Ingestion job queued successfully', jobId: job.id, duration });
                return NextResponse.json({
                    status: 'queued',
                    jobId: job.id,
                    message: 'Ingestion started in background'
                }, { status: 202 }); // 202 Accepted
            } catch (queueError) {
                logger.warn({
                    msg: 'Failed to queue ingestion job, falling back to sync processing',
                    error: queueError instanceof Error ? queueError.message : String(queueError)
                });
                // Fall through to synchronous processing
            }
        }

        // Synchronous processing (fallback or when requested)
        logger.info({ msg: 'Running ingestion synchronously', csvPath, sync });
        const result = await runIngestion(csvPath);

        const duration = Date.now() - startTime;

        if (result.status === 'error') {
            logger.error({ msg: 'Ingestion failed', error: result.error, duration });
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        logger.info({ msg: 'Ingestion completed successfully', rows: result.rows, duration });
        return NextResponse.json({ status: result.status, rows: result.rows });
    } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ msg: 'Ingestion error', error: errorMessage, duration });
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
