// app/api/nse/most-active/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import { normalizeMostActive } from "@/lib/nse/normalize";
import logger from "@/lib/logger";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";

/**
 * Fetch most active securities from NSE
 */
async function fetchMostActiveFromNse(): Promise<any> {
  const data = await nseFetch("https://www.nseindia.com/api/live-analysis-most-active-securities?index=value");
  const normalized = normalizeMostActive(data);
  return {
    data: normalized,
    timestamp: data.timestamp
  };
}

export async function GET(req: Request) {
  try {
    const url = req.url ? new URL(req.url) : new URL('http://localhost');
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";

    let mostActiveResult;
    
    if (forceRefresh) {
      mostActiveResult = await forceRefreshCache(fetchMostActiveFromNse, "most_active");
    } else {
      mostActiveResult = await getOrFetchNseData(fetchMostActiveFromNse, {
        dataType: "most_active",
        ttlSecondsOpen: 60,
        ttlSecondsClosed: 600
      });
    }

    logger.info({ 
      msg: "Most Active: Serving from cache", 
      source: mostActiveResult.source
    });
    
    return NextResponse.json(
      mostActiveResult.data,
      {
        headers: { 
          "Cache-Control": "public, max-age=60",
          "X-Source": mostActiveResult.source,
          "X-Last-Synced": mostActiveResult.lastSyncedAt?.toISOString() || ""
        }
      }
    );
  } catch (error) {
    logger.error({ msg: "Most Active API error", error });
    return NextResponse.json({ error: "Failed to fetch most active data" }, { status: 500 });
  }
}
