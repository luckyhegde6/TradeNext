import { NextRequest, NextResponse } from "next/server";
import { getMarketAnalytics, getUserEngagementStats } from "@/lib/services/analyticsService";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "market";

    if (type === "engagement") {
      const stats = await getUserEngagementStats();
      return NextResponse.json(stats);
    }

    const analytics = await getMarketAnalytics();
    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Error fetching market analytics:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
