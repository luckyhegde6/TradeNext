import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";

/**
 * Fetch insider trading from NSE
 */
async function fetchInsiderTradingFromNse(): Promise<any[]> {
  const response = await nseFetch("https://www.nseindia.com/api/corporates-pit?") as any;
  const data = response?.data || response || [];
  const insiderData = Array.isArray(data) ? data : [];

  return insiderData.slice(0, 200).map((item: any) => ({
    symbol: item.symbol || "",
    companyName: item.company || "",
    regulation: item.anex || "",
    acqName: item.acqName || "",
    secType: item.secType || "",
    securities: item.secAcq || 0,
    transactionType: item.tdpTransactionType || "",
    broadcastDate: item.date || "",
    xbrl: item.xbrl || "",
    personCategory: item.personCategory || "",
    acqMode: item.acqMode || "",
    exchange: item.exchange || "",
    secVal: item.secVal || 0,
    beforeShares: item.befAcqSharesNo || "",
    beforePer: item.befAcqSharesPer || "",
    afterShares: item.afterAcqSharesNo || "",
    afterPer: item.afterAcqSharesPer || "",
  }));
}

export async function GET(req: Request) {
  try {
    const url = req.url ? new URL(req.url) : new URL('http://localhost');
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";

    let insiderResult;
    
    if (forceRefresh) {
      insiderResult = await forceRefreshCache(fetchInsiderTradingFromNse, "insider_trading");
    } else {
      insiderResult = await getOrFetchNseData(fetchInsiderTradingFromNse, {
        dataType: "insider_trading",
        ttlSecondsOpen: 300,
        ttlSecondsClosed: 3600
      });
    }

    logger.info({ 
      msg: "Insider Trading: Serving from cache", 
      source: insiderResult.source,
      count: (insiderResult.data as any[]).length
    });
    
    return NextResponse.json(
      insiderResult.data,
      {
        headers: { 
          "Cache-Control": "public, max-age=60",
          "X-Source": insiderResult.source,
          "X-Last-Synced": insiderResult.lastSyncedAt?.toISOString() || ""
        }
      }
    );
  } catch (error) {
    logger.error({ msg: "Insider trading API error", error });
    return NextResponse.json({ error: "Failed to fetch insider trading data" }, { status: 500 });
  }
}
