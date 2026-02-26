import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";

export async function GET() {
  try {
    const response = await nseFetch(
      "https://www.nseindia.com/api/corporates-pit?"
    ) as any;

    const data = response?.data || response || [];
    const insiderData = Array.isArray(data) ? data : [];

    const result = insiderData.slice(0, 200).map((item: any) => ({
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

    return NextResponse.json(result);
  } catch (error) {
    console.error("Insider trading API error:", error);
    return NextResponse.json({ error: "Failed to fetch insider trading data" }, { status: 500 });
  }
}
