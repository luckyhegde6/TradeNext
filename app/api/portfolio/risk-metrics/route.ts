import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPortfolioRiskMetrics } from "@/lib/services/portfolioRiskMetricsService";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/risk-metrics
 *
 * Returns risk/performance metrics for the user's portfolio:
 * Sharpe ratio, max drawdown, volatility, beta, win rate.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const metrics = await getPortfolioRiskMetrics(userId);

    return NextResponse.json(metrics);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "Portfolio risk metrics failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
