/**
 * User Telegram Verify API — Verify a user's Telegram chat ID by sending a code.
 *
 * POST /api/user/telegram/verify
 *   Body: { action: "send" }
 *     → Generates a 6-digit code (crypto.randomBytes) and sends it to the user's Telegram
 *   Body: { action: "confirm", code: "123456" }
 *     → Confirms the code and marks the Telegram subscription as verified
 *
 * Security:
 *   - Verification codes stored in DB (survives serverless cold starts)
 *   - Code generated with crypto.randomBytes (CSPRNG)
 *   - Rate limited: max 3 send attempts per 10 minutes per user
 *   - Max 5 confirm attempts per code before requiring a new code
 *   - Codes expire after 10 minutes
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getTelegramEnvConfig } from "@/lib/alerts/delivery/telegram-env";
import { randomInt } from "crypto";

export const runtime = "nodejs";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const CODE_LENGTH = 6;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SEND_ATTEMPTS = 3;
const SEND_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONFIRM_ATTEMPTS = 5;

// In-memory rate limit tracker (lightweight, resets on cold start — acceptable for rate limiting)
const sendAttempts = new Map<number, { count: number; windowStart: number }>();
const confirmAttempts = new Map<number, number>(); // userId → attempts on current code

/**
 * Generate a cryptographically secure 6-digit code.
 */
function generateSecureCode(): string {
  const num = randomInt(1000000);
  return String(num).padStart(CODE_LENGTH, "0");
}

/**
 * Check rate limit for send action.
 */
function checkSendRateLimit(userId: number): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const existing = sendAttempts.get(userId);

  if (!existing || now - existing.windowStart > SEND_WINDOW_MS) {
    sendAttempts.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (existing.count >= MAX_SEND_ATTEMPTS) {
    const retryAfterMs = SEND_WINDOW_MS - (now - existing.windowStart);
    return { allowed: false, retryAfterMs };
  }

  existing.count++;
  return { allowed: true };
}

/**
 * Send a message to a Telegram chat via the bot API.
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const envConfig = getTelegramEnvConfig();
  if (!envConfig?.configured || !envConfig.botToken) {
    logger.warn({ msg: "Telegram bot not configured, cannot send verification code" });
    return false;
  }

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
      select: {
        telegramChatId: true,
        telegramVerified: true,
        name: true,
        verificationCode: true,
        verificationExpiry: true,
      },
    });

    if (!user?.telegramChatId) {
      return NextResponse.json(
        { error: "No Telegram chat ID registered. Register one via POST /api/user/telegram first." },
        { status: 400 }
      );
    }

    if (user.telegramVerified) {
      return NextResponse.json({
        success: true,
        message: "Your Telegram account is already verified.",
        alreadyVerified: true,
      });
    }

    if (action === "send") {
      // Rate limit check
      const rateCheck = checkSendRateLimit(userId);
      if (!rateCheck.allowed) {
        const retryMin = Math.ceil((rateCheck.retryAfterMs || 0) / 60000);
        return NextResponse.json(
          { error: `Too many attempts. Please try again in ${retryMin} minute(s).` },
          { status: 429 }
        );
      }

      // Check if bot is configured
      const envConfig = getTelegramEnvConfig();
      if (!envConfig?.configured) {
        return NextResponse.json(
          { error: "Telegram bot is not configured on the server. Please contact admin." },
          { status: 503 }
        );
      }

      // Generate and store verification code in DB
      const code = generateSecureCode();
      const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

      await prisma.user.update({
        where: { id: userId },
        data: {
          verificationCode: code,
          verificationExpiry: expiresAt,
        },
      });

      // Reset confirm attempts
      confirmAttempts.delete(userId);

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
          { error: "Failed to send verification code. Check that your chat ID is correct and the bot is running." },
          { status: 502 }
        );
      }
    }

    if (action === "confirm") {
      const { code } = body;

      if (!code || typeof code !== "string" || code.trim().length !== CODE_LENGTH) {
        return NextResponse.json({ error: `Verification code must be ${CODE_LENGTH} digits.` }, { status: 400 });
      }

      // Check confirm attempt limit
      const attempts = confirmAttempts.get(userId) || 0;
      if (attempts >= MAX_CONFIRM_ATTEMPTS) {
        confirmAttempts.delete(userId);
        return NextResponse.json(
          { error: "Too many failed attempts. Click 'Send Code' to get a new code." },
          { status: 429 }
        );
      }
      confirmAttempts.set(userId, attempts + 1);

      // Read from DB
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { verificationCode: true, verificationExpiry: true },
      });

      if (!current?.verificationCode || !current?.verificationExpiry) {
        return NextResponse.json(
          { error: "No verification code found. Click 'Send Code' first." },
          { status: 400 }
        );
      }

      if (new Date() > current.verificationExpiry) {
        // Clear expired code
        await prisma.user.update({
          where: { id: userId },
          data: { verificationCode: null, verificationExpiry: null },
        });
        return NextResponse.json(
          { error: "Verification code expired. Click 'Send Code' to get a new one." },
          { status: 400 }
        );
      }

      if (code.trim() !== current.verificationCode) {
        return NextResponse.json(
          { error: "Incorrect verification code. Check your Telegram and try again." },
          { status: 400 }
        );
      }

      // Code correct — mark user as verified and clear code
      await prisma.user.update({
        where: { id: userId },
        data: {
          telegramVerified: true,
          verificationCode: null,
          verificationExpiry: null,
        },
      });

      confirmAttempts.delete(userId);

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
