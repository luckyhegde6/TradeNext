import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTelegramEnvStatus,
  verifyTelegramEnv,
} from "@/lib/alerts/delivery/telegram-env";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/alerts/telegram-status — Get env-based Telegram config status.
 *
 * Returns masked/non-sensitive info only. Never exposes the bot token or chat ID fully.
 * Auth: Admin only.
 *
 * Query:
 *   verify=true — Also calls Telegram getMe API to verify the bot token
 *
 * Response:
 * {
 *   configured: boolean;
 *   chatId: string;           // masked (last 4 chars)
 *   hasBotToken: boolean;
 *   hasMessageId: boolean;
 *   botUsername?: string;     // only when verify=true
 *   lastVerified?: string;
 *   error?: string;
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const verify = searchParams.get("verify") === "true";

    let status;
    if (verify) {
      status = await verifyTelegramEnv();
      logger.info({
        msg: "Admin verified Telegram env config",
        configured: status.configured,
        botUsername: status.botUsername,
      });
    } else {
      status = getTelegramEnvStatus();
    }

    return NextResponse.json(status);
  } catch (err) {
    logger.error({
      msg: "Admin: Failed to get Telegram env status",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to get Telegram status" },
      { status: 500 }
    );
  }
}
