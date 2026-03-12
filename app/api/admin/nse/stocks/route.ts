// app/api/admin/nse/stocks/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncStocksToDatabase, getIndexStocks, getEquityMaster } from "@/lib/index-service";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Get available stock lists or sync stocks
 * Query params:
 * - action: "list" | "sync"
 * - index: Index name (for list or sync)
 */
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action') as string;
        const index = searchParams.get('index') as string;

        if (action === 'list') {
            // Get available indices
            const indices = [
                { name: "NIFTY 50", url: "NIFTY 50" },
                { name: "NIFTY NEXT 50", url: "NIFTY NEXT 50" },
                { name: "NIFTY MIDCAP 50", url: "NIFTY MIDCAP 50" },
                { name: "NIFTY SMALLCAP 100", url: "NIFTY SMALLCAP 100" },
                { name: "NIFTY TOTAL MARKET", url: "NIFTY TOTAL MARKET" },
                { name: "NIFTY 100", url: "NIFTY 100" },
                { name: "NIFTY 200", url: "NIFTY 200" },
                { name: "NIFTY 500", url: "NIFTY 500" },
            ];
            return NextResponse.json({ indices });
        }

        if (action === 'sync') {
            if (!index) {
                return NextResponse.json({ error: "Missing parameter: index" }, { status: 400 });
            }

            logger.info({ msg: "Starting stock sync from NSE", index, admin: session.user.email });

            const result = await syncStocksToDatabase(index);

            await createAuditLog({
                action: 'ADMIN_INGEST',
                resource: 'NSE_STOCKS_SYNC',
                method: 'GET',
                path: `/api/admin/nse/stocks?action=sync&index=${index}`,
                responseStatus: result.success ? 200 : 500,
                metadata: {
                    index,
                    ...result
                }
            });

            return NextResponse.json(result);
        }

        // Default: return available indices
        const indices = [
            { name: "NIFTY 50", url: "NIFTY 50" },
            { name: "NIFTY NEXT 50", url: "NIFTY NEXT 50" },
            { name: "NIFTY MIDCAP 50", url: "NIFTY MIDCAP 50" },
            { name: "NIFTY SMALLCAP 100", url: "NIFTY SMALLCAP 100" },
            { name: "NIFTY TOTAL MARKET", url: "NIFTY TOTAL MARKET" },
            { name: "NIFTY 100", url: "NIFTY 100" },
            { name: "NIFTY 200", url: "NIFTY 200" },
            { name: "NIFTY 500", url: "NIFTY 500" },
        ];

        return NextResponse.json({ 
            message: "Use action=sync&index=INDEX_NAME to sync stocks",
            indices 
        });

    } catch (error) {
        logger.error({ msg: "Stock sync error", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ 
            error: "Failed to sync stocks",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

/**
 * POST: Bulk sync from multiple indices
 */
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { indices } = body;

        if (!indices || !Array.isArray(indices) || indices.length === 0) {
            return NextResponse.json({ error: "Missing required field: indices (array)" }, { status: 400 });
        }

        logger.info({ msg: "Starting bulk stock sync from NSE", indices, admin: session.user.email });

        const results: Record<string, any> = {};
        let totalSynced = 0;
        let totalErrors = 0;

        for (const index of indices) {
            const result = await syncStocksToDatabase(index);
            results[index] = result;
            if (result.success) {
                totalSynced += result.synced || 0;
                totalErrors += result.errors || 0;
            }
        }

        await createAuditLog({
            action: 'ADMIN_INGEST',
            resource: 'NSE_STOCKS_BULK_SYNC',
            method: 'POST',
            path: '/api/admin/nse/stocks',
            responseStatus: 200,
            metadata: {
                indices,
                totalSynced,
                totalErrors,
                results
            }
        });

        return NextResponse.json({
            success: true,
            totalSynced,
            totalErrors,
            results
        });

    } catch (error) {
        logger.error({ msg: "Bulk stock sync error", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ 
            error: "Failed to sync stocks",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
