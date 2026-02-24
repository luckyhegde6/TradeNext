import { NextRequest, NextResponse } from "next/server";
import { getStockAnalytics } from "@/lib/services/analyticsService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const url = new URL(req.url);
    const period = (url.searchParams.get("period") || "1M") as "1D" | "1W" | "1M" | "3M" | "1Y";

    if (!ticker) {
      return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
    }

    const analytics = await getStockAnalytics(ticker.toUpperCase(), period);
    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Error fetching stock analytics:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
