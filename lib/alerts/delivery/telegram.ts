/**
 * Telegram Delivery Channel — sends alert notifications via Telegram Bot API.
 *
 * Configure via AlertChannel.config JSON:
 * {
 *   "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
 *   "chatId": "-1001234567890",
 *   "parseMode": "Markdown" | "HTML"
 * }
 */

import logger from "@/lib/logger";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  parseMode?: "Markdown" | "HTML";
}

export interface DeliveryResult {
  success: boolean;
  error?: string;
}

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Validate a telegram config before sending.
 */
export function validateTelegramConfig(config: TelegramConfig): string | null {
  if (!config.botToken) return "Missing Telegram bot token";
  if (!config.botToken.includes(":")) return "Invalid bot token format (expected bot_token:xxx)";
  if (!config.chatId) return "Missing Telegram chat ID";
  return null;
}

/**
 * Send an alert via Telegram bot.
 */
export async function sendTelegramAlert(
  config: TelegramConfig,
  text: string,
  link?: string
): Promise<DeliveryResult> {
  try {
    const validateErr = validateTelegramConfig(config);
    if (validateErr) return { success: false, error: validateErr };

    // Build message with optional link button
    const message: Record<string, unknown> = {
      chat_id: config.chatId,
      text: text + (link ? `\n\n[View Details](${link})` : ""),
      parse_mode: config.parseMode || "Markdown",
      disable_web_page_preview: false,
    };

    const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      const errorMsg = data.description || `HTTP ${response.status}`;
      logger.error({
        msg: "Telegram alert delivery failed",
        chatId: config.chatId,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }

    logger.info({
      msg: "Telegram alert sent",
      chatId: config.chatId,
    });

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({
      msg: "Telegram alert delivery exception",
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Send a test message to verify Telegram bot + chat are configured correctly.
 */
export async function testTelegramChannel(config: TelegramConfig): Promise<DeliveryResult> {
  return sendTelegramAlert(
    config,
    "*TradeNext Test*\nYour Telegram alert channel is configured correctly! ✅",
    undefined
  );
}

/**
 * Get bot info to verify the token is valid.
 */
export async function getTelegramBotInfo(botToken: string): Promise<{
  success: boolean;
  username?: string;
  error?: string;
}> {
  try {
    const response = await fetch(
      `${TELEGRAM_API_BASE}/bot${botToken}/getMe`,
      { method: "GET" }
    );
    const data = await response.json().catch(() => ({}));
    if (data.ok && data.result) {
      return {
        success: true,
        username: data.result.username,
      };
    }
    return {
      success: false,
      error: data.description || "Invalid bot token",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
