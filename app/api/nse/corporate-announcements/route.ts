import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";

/**
 * Fetch corporate announcements from NSE
 */
async function fetchAnnouncementsFromNse(): Promise<any[]> {
  const data = await nseFetch("https://www.nseindia.com/api/corporate-announcements?index=equities") as any[];
  const announcements = Array.isArray(data) ? data : [];

  return announcements.slice(0, 100).map((item: any) => ({
    symbol: item.symbol || "",
    companyName: item.sm_name || "",
    desc: item.desc || "",
    dt: item.dt || "",
    attchmntFile: item.attchmntFile || "",
    sm_isin: item.sm_isin || "",
    an_dt: item.an_dt || "",
    sort_date: item.sort_date || "",
    seq_id: item.seq_id || "",
    smIndustry: item.smIndustry || "",
    attchmntText: item.attchmntText || "",
    fileSize: item.fileSize || "",
    attFileSize: item.attFileSize || "",
    hasXbrl: item.hasXbrl || false,
  }));
}

export async function GET(req: Request) {
  try {
    const url = req.url ? new URL(req.url) : new URL('http://localhost');
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";

    let announcementsResult;
    
    if (forceRefresh) {
      announcementsResult = await forceRefreshCache(fetchAnnouncementsFromNse, "announcements");
    } else {
      announcementsResult = await getOrFetchNseData(fetchAnnouncementsFromNse, {
        dataType: "announcements",
        ttlSecondsOpen: 180,
        ttlSecondsClosed: 1800
      });
    }

    logger.info({ 
      msg: "Corporate Announcements: Serving from cache", 
      source: announcementsResult.source,
      count: (announcementsResult.data as any[]).length
    });
    
    return NextResponse.json(
      announcementsResult.data,
      {
        headers: { 
          "Cache-Control": "public, max-age=60",
          "X-Source": announcementsResult.source,
          "X-Last-Synced": announcementsResult.lastSyncedAt?.toISOString() || ""
        }
      }
    );
  } catch (error) {
    logger.error({ msg: "Corporate announcements API error", error });
    return NextResponse.json({ error: "Failed to fetch corporate announcements" }, { status: 500 });
  }
}
