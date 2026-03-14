import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import logger from "@/lib/logger";
import { getOrFetchNseData, forceRefreshCache, type DataType } from "@/lib/market-cache";

/**
 * Fetch insider trading from NSE - proper parsing
 * API: https://www.nseindia.com/api/corporates-pit?
 */
async function fetchInsiderTradingFromNse(): Promise<any[]> {
  const response = await nseFetch("https://www.nseindia.com/api/corporates-pit?") as any;
  const data = response?.data || response || [];
  const insiderData = Array.isArray(data) ? data : [];

  // Map to proper format based on NSE sample data
  return insiderData.slice(0, 200).map((item: any) => ({
    // Symbol and Company
    symbol: item.symbol || "",
    companyName: item.company || "",
    
    // Regulation (e.g., "7(2)")
    regulation: item.anex || "",
    
    // Acquirer Name
    acqName: item.acqName || "",
    
    // Security Type
    secType: item.secType || "",
    
    // No. of Securities (parse to number)
    securities: parseInt(item.secAcq?.toString().replace(/,/g, '')) || 0,
    
    // Transaction Type (Buy/Sell/Pledge)
    transactionType: item.tdpTransactionType || "",
    
    // Broadcast Date/Time
    broadcastDate: item.date || "",
    
    // XBRL Link
    xbrl: item.xbrl || "",
    
    // Person Category
    personCategory: item.personCategory || "",
    
    // Acquisition Mode
    acqMode: item.acqMode || "",
    
    // Exchange
    exchange: item.exchange || "",
    
    // Value
    secVal: item.secVal || 0,
    
    // Before Acquisition
    beforeShares: item.befAcqSharesNo || "",
    beforePer: item.befAcqSharesPer || "",
    
    // After Acquisition
    afterShares: item.afterAcqSharesNo || "",
    afterPer: item.afterAcqSharesPer || "",
    
    // Additional fields
    pid: item.pid || "",
    did: item.did || "",
    buyValue: item.buyValue || 0,
    sellValue: item.sellValue || 0,
    remarks: item.remarks || "-"
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
