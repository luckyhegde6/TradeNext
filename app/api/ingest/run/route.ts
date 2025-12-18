// app/api/ingest/run/route.ts
import { NextResponse } from 'next/server';
import { runIngestion } from '@/lib/services/ingestService';
import logger from '@/lib/logger';
import { z } from 'zod';

const ingestRequestSchema = z.object({
    csvPath: z.string().optional(),
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

        const { csvPath } = validationResult.data;

        logger.info({ msg: 'Running ingestion', csvPath });

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
