// app/api/ingest/run/route.ts
import { NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { poolQuery } from '../../../../lib/db/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    // Lazy-load Prisma to avoid build-time initialization
    const { default: prisma } = await import('@/lib/prisma');
    try {
        // Allow JSON { csvPath?: string } to override file in dev
        const body = await req.json().catch(() => ({}));
        const csvPath =
            body?.csvPath ||
            process.env.INGEST_CSV_PATH ||
            path.join(process.cwd(), 'api', 'sample_nse.csv');

        if (!fs.existsSync(csvPath)) {
            return NextResponse.json({ error: 'CSV not found', csvPath }, { status: 400 });
        }

        const csv = fs.readFileSync(csvPath, 'utf8');
        const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true });

        // Use a single DB transaction via raw pg client for upserts (faster for batch)
        const client = await poolQuery.connect();
        await client.query('BEGIN');
        try {
            for (const row of records as Record<string, string>[]) {
                const ticker = (row.SYMBOL || row.symbol || row.Symbol || '').trim();
                const trade_date = row.DATE || row.date || row.Date;
                const open = parseFloat(row.OPEN || row.open || '0') || null;
                const high = parseFloat(row.HIGH || row.high || '0') || null;
                const low = parseFloat(row.LOW || row.low || '0') || null;
                const close = parseFloat(row.CLOSE || row.close || '0') || null;
                const volume = parseInt(row.VOLUME || row.volume || '0', 10) || 0;
                const vwap = parseFloat(row.VWAP || row.vwap || '0') || null;

                const q = `
          INSERT INTO daily_prices(ticker, trade_date, open, high, low, close, volume, vwap)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (ticker, trade_date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            vwap = EXCLUDED.vwap;
        `;
                await client.query(q, [ticker, trade_date, open, high, low, close, volume, vwap]);
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        return NextResponse.json({ status: 'ok', rows: records.length });
    } catch (err: unknown) {
        console.error('Ingest error', err);
        return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
    } finally {
        await prisma.$disconnect();
    }
}
