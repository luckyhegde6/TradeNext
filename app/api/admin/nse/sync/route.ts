import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clearAllCaches } from "@/lib/cache";
import { getIndexDetails } from "@/lib/index-service";
import { getStockQuote } from "@/lib/stock-service";
import { MAJOR_INDICES, INITIAL_SYMBOLS } from "@/lib/constants";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const startTime = Date.now();
        logger.info({ msg: "Starting manual NSE Sync" });

        // 1. Flush all caches
        clearAllCaches();
        logger.debug({ msg: "Caches flushed" });

        // 2. Sync Major Indices
        const indexResults = [];
        for (const index of MAJOR_INDICES) {
            try {
                // Force a fresh fetch by clearing cache before (done by clearAllCaches)
                // getIndexDetails will now fetch fresh from NSE and upsert to DB
                await getIndexDetails(index.key);
                indexResults.push({ name: index.name, status: "success" });
            } catch (err) {
                logger.error({ msg: "Failed to sync index", index: index.key, error: err });
                indexResults.push({ name: index.name, status: "failed" });
            }
        }

        // 3. Sync some major symbols (top 10 from INITIAL_SYMBOLS)
        const symbolResults = [];
        const topSymbols = INITIAL_SYMBOLS.slice(0, 10);
        for (const symbol of topSymbols) {
            try {
                await getStockQuote(symbol);
                symbolResults.push({ symbol, status: "success" });
            } catch (err) {
                logger.error({ msg: "Failed to sync symbol", symbol, error: err });
                symbolResults.push({ symbol, status: "failed" });
            }
        }

        const duration = Date.now() - startTime;

        await createAuditLog({
            action: 'ADMIN_INGEST',
            resource: 'NSE_SYNC',
            metadata: {
                duration,
                indicesSynced: indexResults.length,
                symbolsSynced: symbolResults.length,
                success: true
            }
        });

        return NextResponse.json({
            success: true,
            message: "NSE Sync completed successfully",
            duration,
            indices: indexResults,
            symbols: symbolResults
        });

    } catch (error) {
        logger.error({ msg: "NSE Sync API error", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Failed to perform NSE sync" }, { status: 500 });
    }
}

export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Return current sync status/info if needed
        // For now just basic info
        return NextResponse.json({
            status: "ready",
            majorIndices: MAJOR_INDICES.map(i => i.name),
            monitoredSymbols: INITIAL_SYMBOLS.length
        });
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch sync status" }, { status: 500 });
    }
}
