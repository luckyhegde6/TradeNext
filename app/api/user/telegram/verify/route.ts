/**
 * User Telegram Verify API — Verify a user's Telegram chat ID by sending a code.
 *
 * POST /api/user/telegram/verify
 *   Body: { action: "send" }
 *     → Generates a 6-digit code and sends it to the user's registered Telegram chat
 *   Body: { action: "confirm", code: "123456" }
 *     → Confirms the code and marks the Telegram subscription as verified
 *
 * Flow:
 *   1. User registers chat ID via POST /api/user/telegram
 *   2. User clicks "Send Code" → verification code sent to their Telegram
 *   3. User reads the code from Telegram, enters it on the website
 *   4. User clicks "Verify" → code matched, telegramVerified = true
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getTelegramEnvConfig } from "@/lib/alerts/delivery/telegram-env";

export const runtime = "nodejs";

const TELEGRAM_API_BASE = "https://api.telegram.org";

// In-memory verification code store (codes expire after 10 minutes)
// Key: userId, Value: { code: string, expiresAt: number }
const verificationCodes = new Map<number, { code: string; expiresAt: number }>();

// Clean up expired codes every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of verificationCodes.entries()) {
    if (entry.expiresAt < now) {
      verificationCodes.delete(userId);
    }
  }
}, 5 * 60 * 1000);

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send a message to a Telegram chat via the bot API.
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const envConfig = getTelegramEnvConfig();
  if (!envConfig?.configured) return false;

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${envConfig.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    logger.error({ msg: "Telegram verify: sendMessage failed", chatId, error: err });
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);

    const body = await req.json();
    const { action } = body;

    if (!action || !["send", "confirm"].includes(action)) {
      return NextResponse.json({ error: "action must be 'send' or 'confirm'" }, { status: 400 });
    }

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

    if (action === "send") {
      // Generate and send verification code
      const code = generateCode();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
      verificationCodes.set(userId, { code, expiresAt });

      const envConfig = getTelegramEnvConfig();
      const botName = envConfig?.botToken ? `@${envConfig.botToken.split(":")[0]}` : "TradeNext Bot";

      const ok = await sendTelegramMessage(
        user.telegramChatId,
        `🔐 *TradeNext Verification*\n\n`
          + `Hi${user.name ? ` ${user.name}` : ""}!\n\n`
          + `Your verification code is:\n\n`
          + `\`${code}\`\n\n`
          + `Enter this code on the TradeNext website to complete your Telegram subscription.\n\n`
          + `This code expires in 10 minutes.\n`
          + `If you didn't request this, you can ignore this message.`
      );

      if (ok) {
        logger.info({ msg: "Telegram verification code sent", userId });
        return NextResponse.json({
          success: true,
          message: "Verification code sent to your Telegram.",
          hint: code.slice(-2), // Show last 2 digits as hint
        });
      } else {
        return NextResponse.json(
          { error: "Failed to send verification code. Check that your chat ID is correct." },
          { status: 502 }
        );
      }
    }

    if (action === "confirm") {
      const { code } = body;

      if (!code || typeof code !== "string" || code.trim().length !== 6) {
        return NextResponse.json({ error: "Verification code must be 6 digits." }, { status: 400 });
      }

      const stored = verificationCodes.get(userId);
      if (!stored) {
        return NextResponse.json(
          { error: "No verification code found. Click 'Send Code' first." },
          { status: 400 }
        );
      }

      if (Date.now() > stored.expiresAt) {
        verificationCodes.delete(userId);
        return NextResponse.json(
          { error: "Verification code expired. Click 'Send Code' to get a new one." },
          { status: 400 }
        );
      }

      if (code.trim() !== stored.code) {
        return NextResponse.json(
          { error: "Incorrect verification code. Check your Telegram and try again." },
          { status: 400 }
        );
      }

      // Code correct — mark user as verified
      await prisma.user.update({
        where: { id: userId },
        data: { telegramVerified: true },
      });

      verificationCodes.delete(userId);

      // Send confirmation message
      await sendTelegramMessage(
        user.telegramChatId,
        `✅ *Telegram Verified!*\n\n`
          + `Your TradeNext account is now linked.\n`
          + `You'll start receiving alerts here.\n\n`
          + `Try:\n`
          + `• /recommendations — Current stock recommendations\n`
          + `• /alerts — Check your alerts\n`
          + `• /help — Show all commands`
      ).catch(() => {});

      logger.info({ msg: "User verified Telegram subscription", userId });

      return NextResponse.json({
        success: true,
        message: "Telegram verified! You'll now receive alerts via the bot.",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    logger.error({ msg: "Telegram verification failed", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
