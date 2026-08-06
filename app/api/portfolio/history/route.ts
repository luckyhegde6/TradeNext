import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPortfolioValueHistory } from "@/lib/services/portfolioHistoryService";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/history
 *
 * Returns portfolio value over time for the P&L Over Time chart.
 * Reconstructs daily values from transaction history + DailyPrice data.
 *
 * Query params:
 *   maxPoints - max data points to return (default 120, for chart display)
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const maxPoints = Math.min(Math.max(parseInt(searchParams.get("maxPoints") || "120") || 120, 10), 500);

    const userId = Number(session.user.id);
    const data = await getPortfolioValueHistory(userId, maxPoints);

    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "Portfolio history failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
