import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/admin/telegram/subscribers — Get subscriber stats (admin only)
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session || !session.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [total, verified, blocked] = await Promise.all([
      prisma.user.count({
        where: { telegramChatId: { not: null } },
      }),
      prisma.user.count({
        where: { telegramChatId: { not: null }, telegramVerified: true, isBlocked: false },
      }),
      prisma.user.count({
        where: { telegramChatId: { not: null }, isBlocked: true },
      }),
    ]);

    return NextResponse.json({ total, verified, blocked });
  } catch (error) {
    console.error("Admin telegram subscribers GET error:", error);
    return NextResponse.json({ error: "Failed to fetch subscriber stats" }, { status: 500 });
  }
}
