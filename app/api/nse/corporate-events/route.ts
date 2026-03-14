import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";

/**
 * Fetch corporate events from NSE
 */
async function fetchCorporateEventsFromNse(): Promise<any[]> {
  const data = await nseFetch("https://www.nseindia.com/api/event-calendar?") as any;
  const events = Array.isArray(data) ? data : (data?.data || []);

  return events.slice(0, 100).map((item: any) => ({
    symbol: item.symbol || item.SYMBOL || "",
    companyName: item.company || item.COMPANY || "",
    purpose: item.purpose || item.PURPOSE || "",
    details: item.bm_desc || item.details || item.DETAILS || "",
    date: item.date || item.DATE || "",
  }));
}

export async function GET(req: Request) {
  try {
    const url = req.url ? new URL(req.url) : new URL('http://localhost');
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";

    let eventsResult;
    
    if (forceRefresh) {
      eventsResult = await forceRefreshCache(fetchCorporateEventsFromNse, "corporate_events");
    } else {
      eventsResult = await getOrFetchNseData(fetchCorporateEventsFromNse, {
        dataType: "corporate_events",
        ttlSecondsOpen: 300,
        ttlSecondsClosed: 3600
      });
    }

    logger.info({ 
      msg: "Corporate Events: Serving from cache", 
      source: eventsResult.source,
      count: (eventsResult.data as any[]).length
    });
    
    return NextResponse.json(
      eventsResult.data,
      {
        headers: { 
          "Cache-Control": "public, max-age=60",
          "X-Source": eventsResult.source,
          "X-Last-Synced": eventsResult.lastSyncedAt?.toISOString() || ""
        }
      }
    );
  } catch (error) {
    logger.error({ msg: "Corporate events API error", error });
    return NextResponse.json({ error: "Failed to fetch corporate events" }, { status: 500 });
  }
}
