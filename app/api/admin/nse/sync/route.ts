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
    logger.info({ msg: "Starting comprehensive NSE Sync" });

    const results: any = {
      indices: [],
      symbols: [],
      corporateActions: { synced: 0, failed: 0 },
      corporateAnnouncements: { synced: 0, failed: 0 },
    };

    // 1. Flush all caches
    clearAllCaches();
    logger.debug({ msg: "Caches flushed" });

    // 2. Sync Major Indices
    const indexResults: any[] = [];
    for (const index of MAJOR_INDICES) {
      try {
        await getIndexDetails(index.key);
        indexResults.push({ name: index.name, status: "success" });
      } catch (err) {
        logger.error({ msg: "Failed to sync index", index: index.key, error: err });
        indexResults.push({ name: index.name, status: "failed" });
      }
    }
    results.indices = indexResults;

    // 3. Sync some major symbols (top 10 from INITIAL_SYMBOLS)
    const symbolResults: any[] = [];
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
    results.symbols = symbolResults;

    // 4. Sync Corporate Actions from NSE (DB-first, so this populates the cache)
    try {
      // Trigger the combined endpoint which will fetch from NSE and hydrate DB
      const corporateRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/corporate-actions/combined?limit=100`, {
        // Cache: 'no-store' to force fresh fetch
        cache: 'no-store',
      });
      if (corporateRes.ok) {
        const data = await corporateRes.json();
        results.corporateActions.synced = data.data?.length || 0;
        logger.info({ msg: "Corporate actions synced", count: results.corporateActions.synced });
      } else {
        results.corporateActions.failed = 1;
        logger.warn({ msg: "Corporate actions sync failed", status: corporateRes.status });
      }
    } catch (err) {
      results.corporateActions.failed = 1;
      logger.warn({ msg: "Corporate actions sync error", error: err });
    }

    // 5. Sync Corporate Announcements from NSE
    try {
      const announceRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/admin/ingest/announcements`, {
        method: 'POST',
        cache: 'no-store',
      });
      if (announceRes.ok) {
        const data = await announceRes.json();
        results.corporateAnnouncements.synced = data.count || 0;
        logger.info({ msg: "Corporate announcements synced", count: results.corporateAnnouncements.synced });
      } else {
        results.corporateAnnouncements.failed = 1;
        logger.warn({ msg: "Corporate announcements sync failed", status: announceRes.status });
      }
    } catch (err) {
      results.corporateAnnouncements.failed = 1;
      logger.warn({ msg: "Corporate announcements sync error", error: err });
    }

    const duration = Date.now() - startTime;

    await createAuditLog({
      action: 'ADMIN_INGEST',
      resource: 'NSE_SYNC_FULL',
      metadata: {
        duration,
        indicesSynced: indexResults.length,
        symbolsSynced: symbolResults.length,
        corporateActionsSynced: results.corporateActions.synced,
        corporateAnnouncementsSynced: results.corporateAnnouncements.synced,
        success: true
      }
    });

    return NextResponse.json({
      success: true,
      message: "Comprehensive NSE Sync completed",
      duration,
      results
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
