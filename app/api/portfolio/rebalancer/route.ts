import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPortfolioData } from "@/lib/services/portfolioService";
import {
  getUserProfiles,
  computeRebalancer,
} from "@/lib/services/rebalancerService";

export const runtime = "nodejs";

/**
 * GET /api/portfolio/rebalancer
 * Compute rebalancer results for the user's active profile or a specific profile.
 * Query params: ?profileId=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId");

    // Get portfolio holdings
    let holdings: any[];
    try {
      const portfolio = await getPortfolioData(userId);
      holdings = portfolio.holdings || [];
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to fetch portfolio" },
        { status: 500 }
      );
    }

    // Get profiles
    const profiles = await getUserProfiles(userId);
    let targetProfile = profileId
      ? profiles.find((p) => p.id === profileId) || null
      : profiles[0] || null;

    if (!targetProfile) {
      return NextResponse.json({
        hasProfile: false,
        holdings,
        message: "No rebalancer profile found. Create one first.",
      });
    }

    const result = computeRebalancer(holdings, targetProfile);
    return NextResponse.json({ hasProfile: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
