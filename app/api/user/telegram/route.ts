/**
 * User Telegram Subscription API — Manage user's Telegram chat ID for alert delivery.
 *
 * GET  /api/user/telegram  — Get current user's Telegram subscription status
 * POST /api/user/telegram  — Update/register Telegram chat ID
 * DELETE /api/user/telegram — Remove Telegram subscription
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET — Return current user's Telegram subscription status (masked chat ID).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, telegramVerified: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Mask the chat ID for the response (show last 4 chars)
    const maskedChatId = user.telegramChatId
      ? user.telegramChatId.length > 4
        ? `...${user.telegramChatId.slice(-4)}`
        : "****"
      : null;

    return NextResponse.json({
      subscribed: !!user.telegramChatId,
      verified: user.telegramVerified,
      chatId: maskedChatId,
      // Only expose raw chat ID for verification (last 4 chars as hint)
      chatIdHint: user.telegramChatId?.slice(-4) || null,
    });
  } catch (err) {
    logger.error({ msg: "Failed to get Telegram subscription", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST — Register or update the user's Telegram chat ID.
 *
 * Body: { chatId: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);

    const body = await req.json();
    const { chatId } = body;

    if (!chatId || typeof chatId !== "string" || chatId.trim().length === 0) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const trimmedChatId = chatId.trim();

    // Validate chat ID format (numeric or @username)
    const isNumeric = /^-?\d+$/.test(trimmedChatId);
    const isUsername = trimmedChatId.startsWith("@");
    if (!isNumeric && !isUsername) {
      return NextResponse.json(
        { error: "Invalid chat ID format. Must be a numeric ID or @username." },
        { status: 400 }
      );
    }

    // Check if chat ID is already used by another user
    const existing = await prisma.user.findFirst({
      where: {
        telegramChatId: trimmedChatId,
        id: { not: userId },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "This Telegram chat ID is already registered by another user." },
        { status: 409 }
      );
    }

    // Update user
    await prisma.user.update({
      where: { id: userId },
      data: {
        telegramChatId: trimmedChatId,
        telegramVerified: false, // Reset verification on change
      },
    });

    logger.info({ msg: "User registered Telegram chat ID", userId, chatId: trimmedChatId });

    return NextResponse.json({
      success: true,
      message: "Telegram chat ID registered. Use the test endpoint to verify it works.",
      chatIdHint: trimmedChatId.slice(-4),
      verified: false,
    });
  } catch (err) {
    logger.error({ msg: "Failed to update Telegram subscription", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE — Remove the user's Telegram subscription.
 */
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);

    await prisma.user.update({
      where: { id: userId },
      data: {
        telegramChatId: null,
        telegramVerified: false,
      },
    });

    logger.info({ msg: "User removed Telegram subscription", userId });

    return NextResponse.json({ success: true, message: "Telegram subscription removed." });
  } catch (err) {
    logger.error({ msg: "Failed to remove Telegram subscription", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
