// lib/services/worker/screener-service.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { scanStocks } from "@/lib/services/tradingview-service";

/**
 * Screener Service - Handles periodic synchronization of TradingView screener data
 */

/**
 * Perform a full daily sync of TradingView screener data for the Indian market
 */
export async function syncDailyScreener(): Promise<{ success: boolean; recordCount: number; message?: string }> {
    // Normalize current date to midnight for daily snapshots
    const now = new Date();
    const syncDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    logger.info({ msg: "Starting daily screener sync", syncDate: syncDate.toISOString() });

    try {
        // 1. Check if sync already exists for today
        const existingSync = await prisma.dailyScreenerSync.findUnique({
            where: { syncDate },
        });

        if (existingSync && existingSync.status === "completed") {
            logger.info({ msg: "Screener sync already completed for today", syncDate: syncDate.toISOString() });
            return { success: true, recordCount: existingSync.recordCount, message: "Sync already exists for today" };
        }

        // 2. Fetch full screener data from TradingView
        // We'll fetch a larger range to get complete market data
        // TradingView usually allows up to 500-1000 per request, we might need multiple calls or one large one
        // Let's start with 1000 for NIFTY/Smallcap/Midcap coverage
        const results = await scanStocks({
            filter: [
                { left: "exchange", operation: "equal", right: "NSE" },
            ],
            range: { from: 0, to: 2000 }, // Fetch top 2000 stocks
        });

        if (!results || results.length === 0) {
            throw new Error("No results fetched from TradingView");
        }

        // 3. Store in the database as a daily snapshot (JSONB)
        const sync = await prisma.dailyScreenerSync.upsert({
            where: { syncDate },
            create: {
                syncDate,
                data: results as any,
                recordCount: results.length,
                status: "completed",
            },
            update: {
                data: results as any,
                recordCount: results.length,
                status: "completed",
                updatedAt: new Date(),
            },
        });

        logger.info({ msg: "Daily screener sync completed", recordCount: results.length, syncId: sync.id });
        return { success: true, recordCount: results.length };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ msg: "Daily screener sync failed", error: errorMessage });

        // Save failed status if possible
        try {
            await prisma.dailyScreenerSync.upsert({
                where: { syncDate },
                create: {
                    syncDate,
                    data: [],
                    status: "failed",
                    error: errorMessage,
                },
                update: {
                    status: "failed",
                    error: errorMessage,
                }
            });
        } catch (e) {
            logger.error({ msg: "Failed to log screener sync failure to DB", error: e });
        }

        return { success: false, recordCount: 0, message: errorMessage };
    }
}

/**
 * Get the latest available screener snapshot
 */
export async function getLatestScreenerData() {
    return prisma.dailyScreenerSync.findFirst({
        orderBy: { syncDate: "desc" },
    });
}
