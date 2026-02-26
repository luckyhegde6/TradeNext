import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPortfolioAnalytics } from "@/lib/services/analyticsService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Portfolio ID is required" }, { status: 400 });
    }

    const analytics = await getPortfolioAnalytics(id, userId);
    
    if (!analytics) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Error fetching portfolio analytics:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
