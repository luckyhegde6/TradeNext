import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import cache from "@/lib/cache";
import { getSqliteFallback } from "@/lib/sqlite";
import { isMarketOpen } from "@/lib/market-hours";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const warmPayload = z.object({
  dataType: z.enum(["announcements", "events", "corporate-actions", "gainers", "losers", "mostActive", "advanceDecline", "blockDeals", "bulkDeals", "shortSelling", "financialResults"]),
  data: z.any(),
  indexName: z.string().optional(),
});

function toRecordCount(data: unknown): number {
  return Array.isArray(data) ? data.length : 1;
}

export async function POST(req: Request) {
  const session = await auth();
  const user = (session as any)?.user;
  const isAdmin = user?.role === "admin" || user?.email === "admin@tradenext6.app";
  if (!session?.user || !isAdmin) {
    return NextResponse.json({ success: false, error: "Admin only" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = warmPayload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid payload" }, { status: 400 });
  }

  const { dataType, data, indexName } = parsed.data;
  const cacheKey = indexName ? `${dataType}:${indexName}` : dataType;
  const memKey = `mc:${cacheKey}`;
  const marketOpen = isMarketOpen();
  const now = new Date();
  const ttlOpen = dataType === "announcements" ? 180 : dataType === "events" ? 360 : 300;
  const ttlClosed = dataType === "announcements" ? 1800 : dataType === "events" ? 3600 : 7200;
  const memTtl = marketOpen ? ttlOpen : ttlClosed;
  const nextSync = new Date(now.getTime() + memTtl * 1000);

  // Memory
  cache.set(memKey, { data, lastSyncedAt: now }, memTtl);

  // SQLITE mirror
  const sqlite = getSqliteFallback();
  if (sqlite?.isReady()) {
    sqlite.upsertMarketCache({
      cacheKey,
      dataType,
      indexName: indexName || null,
      data,
      recordCount: toRecordCount(data),
      nseLastModified: null,
      lastSyncedAt: now,
      nextSyncAt: nextSync,
      marketStatus: marketOpen ? "open" : "closed",
      syncStatus: "idle",
      syncError: null,
    });
    logger.info({ msg: "Admin nse-warm: upsertMarketCache", dataType, cacheKey, recordCount: toRecordCount(data) });
  }

  // Prisma is intentionally NOT written during hold (OTP-only). The 6h pushSqliteToPrisma will restore when hold lifts.

  return NextResponse.json({ success: true, dataType, cacheKey, recordCount: toRecordCount(data), lastSyncedAt: now.toISOString(), nextSyncAt: nextSync.toISOString() });
}
