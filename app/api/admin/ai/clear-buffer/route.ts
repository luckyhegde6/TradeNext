import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clearAiCalls } from "@/lib/services/ai/ai-monitoring";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/admin/ai/clear-buffer — Clear the in-memory AI call buffer
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    clearAiCalls();
    logger.info({ msg: "AI call buffer cleared by admin" });

    return NextResponse.json({ success: true, message: "Buffer cleared" });
  } catch (err) {
    logger.error({ msg: "Failed to clear AI buffer", error: err });
    return NextResponse.json(
      { success: false, error: "Failed to clear buffer" },
      { status: 500 }
    );
  }
}
