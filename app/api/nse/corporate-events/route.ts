import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";

export async function GET() {
  try {
    const data = await nseFetch(
      "https://www.nseindia.com/api/event-calendar?"
    ) as any;

    const events = Array.isArray(data) ? data : (data?.data || []);

    const result = events.slice(0, 100).map((item: any) => ({
      symbol: item.symbol || item.SYMBOL || "",
      companyName: item.company || item.COMPANY || "",
      purpose: item.purpose || item.PURPOSE || "",
      details: item.bm_desc || item.details || item.DETAILS || "",
      date: item.date || item.DATE || "",
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Corporate events API error:", error);
    return NextResponse.json({ error: "Failed to fetch corporate events" }, { status: 500 });
  }
}
