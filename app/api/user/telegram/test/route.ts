/**
 * User Telegram Test API — Send a test message to the user's registered Telegram.
 *
 * POST /api/user/telegram/test
 *   Sends a test message to the authenticated user's registered Telegram chat.
 *   Returns success/failure so the user can confirm their subscription works.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { sendAlertToUser } from "@/lib/services/telegramBotService";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);

    // Get user's Telegram subscription
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, telegramVerified: true, name: true },
    });

    if (!user?.telegramChatId) {
      return NextResponse.json(
        { error: "No Telegram chat ID registered. Register one via POST /api/user/telegram first." },
        { status: 400 }
      );
    }

    // Send test message
    const ok = await sendAlertToUser(
      user.telegramChatId,
      "✅ Test Message",
      `Hello${user.name ? ` ${user.name}` : ""}! This is a test from TradeNext.\n\n`
        + `• Your Telegram subscription is working ✅\n`
        + `• Chat ID: \`${user.telegramChatId}\`\n`
        + `• Verified: ${user.telegramVerified ? "Yes ✅" : "No ⏳"}\n\n`
        + `You'll receive alerts here when your rules trigger.`
    );

    if (ok) {
      logger.info({ msg: "User sent Telegram test message", userId });
      return NextResponse.json({ success: true, message: "Test message sent! Check your Telegram." });
    } else {
      return NextResponse.json(
        { error: "Failed to send test message. Check that your chat ID is correct and the bot is not blocked." },
        { status: 502 }
      );
    }
  } catch (err) {
    logger.error({ msg: "Failed to send Telegram test", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
