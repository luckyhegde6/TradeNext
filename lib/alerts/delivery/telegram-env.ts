/**
 * Telegram Environment Configuration — Reads Telegram bot config from env vars.
 *
 * Environment variables:
 *   TELEGRAM_SECRET    — Telegram bot token (required)
 *   TELEGRAM_CHATID    — Target chat/group ID (required, can be numeric or @username)
 *   TELEGRAM_MESSAGEID — Optional message ID for editing existing messages
 *                       (uses editMessageText instead of sendMessage when set)
 *
 * This module is SERVER-ONLY. Never import in client components.
 */
import logger from "@/lib/logger";
import { getTelegramBotInfo } from "./telegram";

// ─── Types ────────────────────────────────────────────────────────────────

export interface TelegramEnvConfig {
  /** Telegram bot token from TELEGRAM_SECRET */
  botToken: string;
  /** Chat ID from TELEGRAM_CHATID */
  chatId: string;
  /** Optional message ID for editMessageText (from TELEGRAM_MESSAGEID) */
  messageId?: string;
  /** Whether all required env vars are configured */
  configured: boolean;
  /** Validation error message if not configured */
  error?: string;
}

export interface TelegramEnvStatus {
  configured: boolean;
  chatId: string;
  hasMessageId: boolean;
  hasBotToken: boolean;
  botUsername?: string;
  lastVerified?: string;
  error?: string;
}

// ─── Read from env ────────────────────────────────────────────────────────

/**
 * Read Telegram config from environment variables.
 * Returns null if TELEGRAM_SECRET or TELEGRAM_CHATID are missing.
 */
export function getTelegramEnvConfig(): TelegramEnvConfig | null {
  const botToken = process.env.TELEGRAM_SECRET || "";
  const chatId = process.env.TELEGRAM_CHATID || "";
  const messageId = process.env.TELEGRAM_MESSAGEID || "";

  const errors: string[] = [];
  if (!botToken) errors.push("TELEGRAM_SECRET is not set");
  if (!chatId) errors.push("TELEGRAM_CHATID is not set");

  if (errors.length > 0) {
    return {
      botToken: "",
      chatId: "",
      messageId: "",
      configured: false,
      error: errors.join("; "),
    };
  }

  return {
    botToken,
    chatId,
    messageId: messageId || undefined,
    configured: true,
  };
}

/**
 * Get a masked Telegram config for admin display (no secrets exposed).
 */
export function getTelegramEnvStatus(): TelegramEnvStatus {
  const config = getTelegramEnvConfig();

  if (!config || !config.configured) {
    return {
      configured: false,
      chatId: "(not set)",
      hasBotToken: !!process.env.TELEGRAM_SECRET,
      hasMessageId: !!process.env.TELEGRAM_MESSAGEID,
      error: config?.error || "Telegram not configured",
    };
  }

  // Mask the chat ID for display (show last 4 chars)
  const maskedChat =
    config.chatId.length > 4
      ? `...${config.chatId.slice(-4)}`
      : "****";

  return {
    configured: true,
    chatId: maskedChat,
    hasMessageId: !!config.messageId,
    hasBotToken: true,
    botUsername: undefined, // populated by verifyTelegramEnv()
  };
}

/**
 * Verify the Telegram env config by calling getMe on the bot API.
 * Returns the bot username on success.
 */
export async function verifyTelegramEnv(): Promise<TelegramEnvStatus> {
  const config = getTelegramEnvConfig();

  if (!config || !config.configured) {
    return {
      configured: false,
      chatId: "(not set)",
      hasBotToken: !!process.env.TELEGRAM_SECRET,
      hasMessageId: !!process.env.TELEGRAM_MESSAGEID,
      error: config?.error || "Telegram not configured",
    };
  }

  try {
    const result = await getTelegramBotInfo(config.botToken);
    if (result.success) {
      const maskedChat =
        config.chatId.length > 4
          ? `...${config.chatId.slice(-4)}`
          : "****";

      return {
        configured: true,
        chatId: maskedChat,
        hasMessageId: !!config.messageId,
        hasBotToken: true,
        botUsername: result.username,
        lastVerified: new Date().toISOString(),
      };
    }

    return {
      configured: false,
      chatId: "(invalid)",
      hasMessageId: !!config.messageId,
      hasBotToken: true,
      error: result.error || "Bot token verification failed",
    };
  } catch (err) {
    logger.error({ msg: "Telegram env verification failed", error: err });
    return {
      configured: false,
      chatId: "(error)",
      hasMessageId: !!config.messageId,
      hasBotToken: true,
      error: err instanceof Error ? err.message : "Verification error",
    };
  }
}

/**
 * Build a default channel config object from env for use with AlertChannel system.
 * This is the JSON that would be stored in AlertChannel.config.
 *
 * NOTE: This should ONLY be used server-side, never sent to the client.
 */
export function buildTelegramChannelConfig(): Record<string, unknown> {
  const config = getTelegramEnvConfig();
  if (!config || !config.configured) {
    return {};
  }
  return {
    botToken: config.botToken,
    chatId: config.chatId,
    parseMode: "Markdown" as const,
    ...(config.messageId ? { messageId: config.messageId } : {}),
  };
}
