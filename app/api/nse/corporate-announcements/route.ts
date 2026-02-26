import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";

export async function GET() {
  try {
    const data = await nseFetch(
      "https://www.nseindia.com/api/corporate-announcements?index=equities"
    ) as any[];

    const announcements = Array.isArray(data) ? data : [];

    const result = announcements.slice(0, 100).map((item: any) => ({
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

    return NextResponse.json(result);
  } catch (error) {
    console.error("Corporate announcements API error:", error);
    return NextResponse.json({ error: "Failed to fetch corporate announcements" }, { status: 500 });
  }
}
