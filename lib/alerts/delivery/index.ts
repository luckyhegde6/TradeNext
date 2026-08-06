/**
 * Alert Delivery Manager — routes alert notifications to configured channels.
 *
 * Supports: in_app (DB notification), email (SMTP), webhook (HTTP POST), telegram
 *
 * Each channel is configured via the AlertChannel model.
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { sendEmailAlert, buildAlertEmailHtml, type EmailConfig } from "./email";
import { sendWebhookAlert, type WebhookConfig } from "./webhook";
import { sendTelegramAlert, type TelegramConfig } from "./telegram";
import { getTelegramEnvConfig, buildTelegramChannelConfig } from "./telegram-env";

export interface AlertContext {
  ruleId: string;
  ruleName: string;
  symbol?: string;
  price?: number;
  change?: number;
  pChange?: number;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  channelId: string;
  channelType: string;
  success: boolean;
  error?: string;
  messageId?: string;
  statusCode?: number;
  durationMs?: number;
}

/**
 * Route an alert to all active channels for a rule, and record events + delivery logs.
 */
export async function deliverAlert(
  context: AlertContext,
  channelIds: string[],
  userId: number
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  const now = new Date();

  // 1. Always create an in-app notification
  await createInAppNotification(context, userId);

  // 2. Deliver to configured channels
  if (channelIds.length > 0) {
    const channels = await prisma.alertChannel.findMany({
      where: {
        id: { in: channelIds },
        isActive: true,
        OR: [{ userId }, { userId: 0 }], // match user-owned OR system-wide channels
      },
    });

    for (const channel of channels) {
      const startTime = Date.now();
      const result = await deliverToChannel(channel, context);
      result.durationMs = Date.now() - startTime;
      results.push(result);

      // Record AlertEvent
      await prisma.alertEvent.create({
        data: {
          ruleId: context.ruleId,
          channelId: channel.id,
          channelType: channel.type,
          status: result.success ? "delivered" : "failed",
          error: result.error,
          metadata: {
            ...(context.metadata as Record<string, unknown> || {}),
            symbol: context.symbol,
            price: context.price,
            message: context.message,
            durationMs: result.durationMs,
          },
          attemptedAt: now,
          deliveredAt: result.success ? now : null,
        },
      });
    }
  }

  // 3. Also send to user's linked Telegram account (if verified and not already covered by a Telegram channel)
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, telegramVerified: true },
    });

    if (user?.telegramChatId && user.telegramVerified) {
      // Check if a Telegram channel already handled delivery
      const alreadyDeliveredViaTelegram = results.some(
        (r) => r.channelType === "telegram" && r.success
      );

      if (!alreadyDeliveredViaTelegram) {
        const { sendAlertToUser } = await import("@/lib/services/telegramBotService");
        const text = `*${context.ruleName}*\n${context.message}${context.symbol ? `\nSymbol: ${context.symbol}` : ""}${context.price ? `\nPrice: ₹${context.price.toLocaleString("en-IN")}` : ""}`;
        const sent = await sendAlertToUser(user.telegramChatId, context.ruleName, text, context.link);

        results.push({
          channelId: "telegram-direct",
          channelType: "telegram",
          success: sent,
          error: sent ? undefined : "Failed to send Telegram message",
        });
      }
    }
  } catch (tgErr) {
    // Non-critical: log but don't fail the delivery
    logger.warn({ msg: "Direct Telegram delivery failed (non-critical)", userId, error: tgErr });
  }

  return results;
}

/**
 * Deliver to a single channel — includes delivery log tracking.
 */
async function deliverToChannel(
  channel: { id: string; type: string; config: any },
  context: AlertContext
): Promise<DeliveryResult> {
  const config =
    typeof channel.config === "string"
      ? JSON.parse(channel.config)
      : channel.config;

  switch (channel.type) {
    case "email": {
      const emailConfig = config as EmailConfig;
      const subject = `[TradeNext] ${context.ruleName}${context.symbol ? ` — ${context.symbol}` : ""}`;
      const html = buildAlertEmailHtml({
        ruleName: context.ruleName,
        symbol: context.symbol,
        price: context.price,
        change: context.change,
        pChange: context.pChange,
        message: context.message,
        link: context.link,
      });
      const result = await sendEmailAlert(emailConfig, subject, html);
      return {
        channelId: channel.id,
        channelType: "email",
        success: result.success,
        error: result.error,
        messageId: result.messageId,
      };
    }

    case "webhook": {
      const webhookConfig = config as WebhookConfig;
      const payload = {
        title: `[TradeNext] ${context.ruleName}`,
        message: context.message,
        fields: {
          Symbol: context.symbol || "N/A",
          Price: context.price ? `₹${context.price.toLocaleString("en-IN")}` : "N/A",
          Change: context.change ? `${context.change >= 0 ? "+" : ""}${context.change.toFixed(2)}` : "N/A",
          "% Change": context.pChange ? `${context.pChange >= 0 ? "+" : ""}${context.pChange.toFixed(2)}%` : "N/A",
          Link: context.link || "N/A",
        },
        color: (context.change || 0) >= 0 ? "green" : "red",
      };
      const result = await sendWebhookAlert(webhookConfig, payload);
      return {
        channelId: channel.id,
        channelType: "webhook",
        success: result.success,
        error: result.error,
        statusCode: result.statusCode,
      };
    }

    case "telegram": {
      // Try channel config first, fall back to env-based Telegram config
      let tgConfig = config as TelegramConfig;

      // If channel has no explicit config but env vars are set, use those
      if (!tgConfig.botToken || !tgConfig.chatId) {
        const envConfig = getTelegramEnvConfig();
        if (envConfig?.configured) {
          tgConfig = {
            botToken: envConfig.botToken,
            chatId: envConfig.chatId,
            parseMode: "Markdown",
            messageId: envConfig.messageId,
          };
        }
      }

      const text = `*${context.ruleName}*\n${context.message}${context.symbol ? `\nSymbol: ${context.symbol}` : ""}${context.price ? `\nPrice: ₹${context.price.toLocaleString("en-IN")}` : ""}`;
      const result = await sendTelegramAlert(tgConfig, text, context.link);
      return {
        channelId: channel.id,
        channelType: "telegram",
        success: result.success,
        error: result.error,
      };
    }

    case "push":
      logger.info({
        msg: "Push channel type not yet implemented",
        channelType: channel.type,
      });
      return {
        channelId: channel.id,
        channelType: "push",
        success: false,
        error: `Channel type '${channel.type}' not yet implemented`,
      };

    default:
      return {
        channelId: channel.id,
        channelType: channel.type,
        success: false,
        error: `Unknown channel type: ${channel.type}`,
      };
  }
}

/**
 * Create an in-app Notification record.
 */
async function createInAppNotification(
  context: AlertContext,
  userId: number
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId,
        type: "alert_triggered",
        title: context.ruleName,
        message: context.message,
        link: context.link || "/alerts",
        deliveryStatus: "delivered",
      },
    });
  } catch (error) {
    logger.error({
      msg: "Failed to create in-app notification",
      userId,
      ruleId: context.ruleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Acknowledge an alert event (mark as seen/addressed by user).
 */
export async function acknowledgeAlert(
  ruleId: string,
  userId: number
): Promise<void> {
  const now = new Date();
  await prisma.alertEvent.updateMany({
    where: {
      ruleId,
      acknowledgedAt: null,
    },
    data: { acknowledgedAt: now },
  });

  // Also update the rule's notification
  await prisma.notification.updateMany({
    where: {
      userId,
      type: "alert_triggered",
      isRead: false,
    },
    data: { isRead: true, acknowledgedAt: now },
  });
}

/**
 * Get delivery statistics for monitoring/observability.
 */
export async function getDeliveryStats(options?: {
  userId?: number;
  hours?: number;
  channelType?: string;
  status?: string;
}) {
  const hours = options?.hours || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const where: any = {
    attemptedAt: { gte: since },
  };
  if (options?.channelType) where.channelType = options.channelType;
  if (options?.status) where.status = options.status;
  if (options?.userId) {
    where.rule = { userId: options.userId };
  }

  const [total, byStatus, byChannel, byHour, failures] = await Promise.all([
    prisma.alertEvent.count({ where, ...(options?.channelType ? {} : {}) }),
    prisma.alertEvent.groupBy({
      by: ["status"],
      where,
      _count: true,
    }),
    prisma.alertEvent.groupBy({
      by: ["channelType"],
      where,
      _count: true,
    }),
    // Hourly breakdown
    prisma.alertEvent.groupBy({
      by: ["status"],
      where: { attemptedAt: { gte: since } },
      _count: true,
    }),
    // Recent failures
    prisma.alertEvent.findMany({
      where: { ...where, status: "failed" },
      orderBy: { attemptedAt: "desc" },
      take: 20,
      include: { rule: { select: { name: true, userId: true } } },
    }),
  ]);

  return {
    total,
    since,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    byChannel: byChannel.map((c) => ({ channelType: c.channelType, count: c._count })),
    recentFailures: failures,
  };
}
