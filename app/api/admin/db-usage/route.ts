import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { dbOpsCounter, isDbWriteBudgetExceeded } from "@/lib/prisma";

/**
 * GET /api/admin/db-usage
 * Returns current DB operations counter for the day (reads, writes, budget status).
 * Useful for monitoring Prisma Postgres plan limit consumption.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const budget = Number(process.env.DB_WRITE_BUDGET) || 8_000;
  const exceeded = isDbWriteBudgetExceeded();

  return NextResponse.json({
    date: dbOpsCounter._day,
    reads: dbOpsCounter.reads,
    writes: dbOpsCounter.writes,
    total: dbOpsCounter.reads + dbOpsCounter.writes,
    writeBudget: budget,
    writeBudgetExceeded: exceeded,
    writeBudgetRemaining: Math.max(0, budget - dbOpsCounter.writes),
  });
}
