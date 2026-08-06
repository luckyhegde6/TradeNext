/**
 * Telegram Bot Webhook — Handles incoming bot commands via the telegramBotService.
 *
 * Endpoint: POST /api/telegram/webhook
 * Set this as your Telegram bot webhook:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<BASE_URL>/api/telegram/webhook
 *
 * Commands supported:
 *   /start            — Welcome message with chat ID and subscription instructions
 *   /chatid           — Show your Telegram chat ID
 *   /help             — List available commands
 *   /recommendations  — Show active stock recommendations (auth required)
 *   /alerts           — Show triggered alerts (auth required)
 *   /updates          — Show latest admin updates (auth required)
 *
 * Security (handled by telegramBotService):
 *   - Per-chat rate limiting (5 commands/min, 20/hr)
 *   - 3-second cooldown between commands
 *   - User verification (must link chat ID on TradeNext)
 *   - Full audit logging
 */
import { NextRequest, NextResponse } from "next/server";
import { getTelegramEnvConfig } from "@/lib/alerts/delivery/telegram-env";
import { handleBotCommand } from "@/lib/services/telegramBotService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/telegram/webhook — Receive updates from Telegram (via webhook or polled).
 *
 * Body: Telegram Update object
 *   { update_id: number, message?: { ... }, callback_query?: { ... } }
 */
export async function POST(req: NextRequest) {
  try {
    const envConfig = getTelegramEnvConfig();
    if (!envConfig?.configured) {
      return NextResponse.json({ ok: false, error: "Telegram not configured" }, { status: 503 });
    }

    const update = await req.json();
    const msg = update.message;

    if (!msg || !msg.text) {
      // Ignore non-text updates (stickers, photos, callback queries, etc.)
      return NextResponse.json({ ok: true });
    }

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const firstName = msg.from?.first_name || "User";

    // Delegate to the bot service — handles rate limiting, routing, audit
    await handleBotCommand(chatId, text, firstName);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ msg: "Telegram webhook handler failed", error: err });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/**
 * GET /api/telegram/webhook — Health check + info about the webhook setup.
 */
export async function GET() {
  const envConfig = getTelegramEnvConfig();

  return NextResponse.json({
    configured: envConfig?.configured || false,
    info: {
      hasBotToken: !!envConfig?.botToken,
      hasChatId: !!envConfig?.chatId,
    },
    instructions: !envConfig?.configured
      ? "Set TELEGRAM_SECRET and TELEGRAM_CHATID in .env to enable."
      : "Bot is configured. To set the webhook, run:\n"
        + `  curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_URL>/api/telegram/webhook"\n`
        + "For local dev, use the getUpdates polling approach or ngrok.",
    timestamp: new Date().toISOString(),
  });
}
