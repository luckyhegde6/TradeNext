import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";

export async function GET() {
  try {
    const data = await nseFetch(
      "https://www.nseindia.com/api/corporate-announcements?index=equities&from=0"
    ) as any[];

    const announcements = Array.isArray(data) ? data : [];
    
    const result = announcements.slice(0, 50).map((item: any) => ({
      symbol: item.symbol || "",
      companyName: item.sm_name || "",
      announcementType: item.desc || "",
      desc: item.attchmntText || "",
      broadcastDate: item.an_dt || "",
      attachmentPath: item.attchmntFile || "",
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Corporate news API error:", error);
    return NextResponse.json({ error: "Failed to fetch corporate news" }, { status: 500 });
  }
}
