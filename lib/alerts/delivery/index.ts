/**
 * Alert Delivery Manager — routes alert notifications to configured channels.
 *
 * Supports: in_app (DB notification), email (SMTP), webhook (HTTP POST)
 *
 * Each channel is configured via the AlertChannel model.
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { sendEmailAlert, buildAlertEmailHtml, type EmailConfig } from "./email";
import { sendWebhookAlert, type WebhookConfig } from "./webhook";

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
}

/**
 * Route an alert to all active channels for a rule, and record events.
 */
export async function deliverAlert(
  context: AlertContext,
  channelIds: string[],
  userId: number
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  // 1. Always create an in-app notification
  await createInAppNotification(context, userId);

  // 2. Deliver to configured channels
  if (channelIds.length > 0) {
    const channels = await prisma.alertChannel.findMany({
      where: {
        id: { in: channelIds },
        isActive: true,
        userId,
      },
    });

    for (const channel of channels) {
      const result = await deliverToChannel(channel, context);
      results.push(result);

      // Record AlertEvent
      await prisma.alertEvent.create({
        data: {
          ruleId: context.ruleId,
          channel: channel.type,
          status: result.success ? "delivered" : "failed",
          error: result.error,
          metadata: context.metadata as any || {},
          acknowledgedAt: null,
        },
      });
    }
  }

  return results;
}

/**
 * Deliver to a single channel.
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
        color:
          (context.change || 0) >= 0
            ? "green"
            : "red",
      };
      const result = await sendWebhookAlert(webhookConfig, payload);
      return {
        channelId: channel.id,
        channelType: "webhook",
        success: result.success,
        error: result.error,
      };
    }

    case "telegram":
    case "push":
      // Placeholder for future channels
      logger.info({
        msg: "Channel type not yet implemented",
        channelType: channel.type,
      });
      return {
        channelId: channel.id,
        channelType: channel.type,
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
